import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { sql } from 'drizzle-orm';
import { users } from '../src/db/schema.js';
import { log } from '../src/util/logger.js';

// The DB pool pulls in every runtime env var at import time. We load it lazily
// (only on a real run) so `--dry-run` works with just a CSV — no BOT_TOKEN/
// Stripe keys/DATABASE_URL required. This `typeof import` type is erased at
// compile time and does NOT trigger that runtime load.
type Db = (typeof import('../src/db/index.js'))['db'];

/**
 * Legacy member import
 * --------------------
 * One-off (but safely repeatable) migration that seeds the `users` table from a
 * pre-bot InviteMember export.
 *
 * Policy: every imported user is functionally a LEAD. No access grants, no
 * subscription rows, first_started_at stays null (so their first real /start
 * notifies admins as a new user). The raw CSV status (lead / customer /
 * churned) is preserved in users.legacy_status — purely informational, shown
 * in /find and available for future broadcast segmentation. It has no
 * behavioral effect anywhere.
 *
 * Input: a semicolon-delimited CSV with the columns
 *
 *     date;userId;name;email;status;referredByAffiliateId
 *
 * (a header row is optional — it is auto-detected). `userId` is the Telegram
 * user id and is the natural key for the whole import.
 *
 * Idempotency
 *   • Users are upserted on `telegram_user_id`. Re-running never duplicates a
 *     user and never clobbers profile data learned since (COALESCE keeps the
 *     existing non-null value; a fresh non-null only fills a blank).
 *   • `source` and `created_at` are set ONLY on first insert, so a member who
 *     later signs up through the bot keeps their real origin, and re-runs don't
 *     rewrite history.
 *   • `legacy_status` and `legacy_affiliate_id` follow the CSV: a fresh
 *     non-null value wins (a newer export reflects newer state), a blank never
 *     erases what we had.
 *
 * Usage:  npm run import-legacy -- [--dry-run] ./path/to/legacy.csv
 *
 * `--dry-run` parses the CSV and reports counts (rows read, valid ids, deduped,
 * wouldGrant — always 0 under this policy) without touching the database — and
 * without needing any runtime env beyond the file itself.
 */

const SOURCE = 'legacy_import';

/** Chunk size for batched multi-row upserts — keeps each statement well-bounded. */
const CHUNK = 500;

interface LegacyRow {
  date: string;
  userId: string;
  name: string;
  email: string;
  status: string;
  referredByAffiliateId: string;
}

const COLUMN_NAMES = ['date', 'userId', 'name', 'email', 'status', 'referredByAffiliateId'] as const;

/** A user we've decided to import, after cleaning + de-duplication. */
interface CleanUser {
  telegramUserId: bigint;
  firstName: string | null;
  email: string | null;
  /** Raw CSV status, kept verbatim (lowercased) in users.legacy_status. */
  legacyStatus: string | null;
  /** referredByAffiliateId from the CSV, kept verbatim in users.legacy_affiliate_id. */
  legacyAffiliateId: string | null;
  createdAt: Date;
}

function usage(): never {
  log.error('missing CSV path argument', {});
  process.stderr.write('\nUsage: npm run import-legacy -- [--dry-run] <path-to-csv>\n\n');
  process.exit(1);
}

/** Parse the legacy `date` column (ISO string or unix epoch); fall back to now. */
function parseDate(raw: string): Date {
  const s = raw?.trim();
  if (!s) return new Date();
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000); // epoch seconds
  if (/^\d{13}$/.test(s)) return new Date(Number(s)); // epoch millis
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function cleanText(raw: string | undefined): string | null {
  const s = raw?.trim();
  return s ? s : null;
}

/**
 * Read + parse the CSV into typed rows. The header row is optional: if the first
 * record's `userId` cell isn't a header label we treat every row as data.
 */
function readRows(path: string): LegacyRow[] {
  const content = readFileSync(path, 'utf8');
  const records = parse(content, {
    delimiter: ';',
    columns: [...COLUMN_NAMES],
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as LegacyRow[];

  // Drop a header row if the file included one (columns:true isn't used so we can
  // tolerate a headerless file, hence this manual check).
  if (records.length > 0 && records[0]!.userId?.toLowerCase() === 'userid') {
    records.shift();
  }
  return records;
}

/**
 * Clean rows and collapse duplicate userIds (last occurrence wins — the most
 * recent export state for that member). Skips rows with a missing/non-numeric id.
 */
function dedupe(rows: LegacyRow[]): { users: CleanUser[]; skipped: number; duplicates: number } {
  const byId = new Map<string, CleanUser>();
  let skipped = 0;

  for (const row of rows) {
    const idRaw = row.userId?.trim();
    if (!idRaw || !/^\d+$/.test(idRaw)) {
      skipped++;
      continue;
    }
    let telegramUserId: bigint;
    try {
      telegramUserId = BigInt(idRaw);
    } catch {
      skipped++;
      continue;
    }
    byId.set(idRaw, {
      telegramUserId,
      firstName: cleanText(row.name),
      email: cleanText(row.email),
      legacyStatus: cleanText(row.status)?.toLowerCase() ?? null,
      legacyAffiliateId: cleanText(row.referredByAffiliateId),
      createdAt: parseDate(row.date),
    });
  }

  const duplicates = rows.length - skipped - byId.size;
  return { users: [...byId.values()], skipped, duplicates };
}

/** Split an array into fixed-size chunks. */
function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Upsert users in batches. On conflict we only fill blanks (COALESCE) and never
 * touch `source`/`created_at`, preserving the record's real origin and age.
 * `legacy_status` and `legacy_affiliate_id` are the exceptions: a fresh
 * non-null value wins, since a newer export reflects newer state.
 */
async function importUsers(db: Db, clean: CleanUser[]): Promise<void> {
  let done = 0;
  for (const batch of chunked(clean, CHUNK)) {
    await db
      .insert(users)
      .values(
        batch.map((u) => ({
          telegramUserId: u.telegramUserId,
          firstName: u.firstName,
          email: u.email,
          legacyStatus: u.legacyStatus,
          legacyAffiliateId: u.legacyAffiliateId,
          source: SOURCE,
          createdAt: u.createdAt,
        })),
      )
      .onConflictDoUpdate({
        target: users.telegramUserId,
        set: {
          firstName: sql`COALESCE(EXCLUDED.first_name, ${users.firstName})`,
          email: sql`COALESCE(EXCLUDED.email, ${users.email})`,
          legacyStatus: sql`COALESCE(EXCLUDED.legacy_status, ${users.legacyStatus})`,
          legacyAffiliateId: sql`COALESCE(EXCLUDED.legacy_affiliate_id, ${users.legacyAffiliateId})`,
        },
      });
    done += batch.length;
    log.info('users upserted', { done, total: clean.length });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) usage();

  const abs = resolve(path);
  log.info('legacy import started', { path: abs, dryRun });

  const rows = readRows(abs);
  const { users: clean, skipped, duplicates } = dedupe(rows);

  log.info('rows parsed', {
    rawRows: rows.length,
    validIds: clean.length,
    skippedInvalid: skipped,
    duplicatesCollapsed: duplicates,
    // Policy: imported users are leads — nothing is ever granted by import.
    wouldGrant: 0,
  });

  if (dryRun) {
    log.info('dry run — no writes performed', {
      rowsRead: rows.length,
      validIds: clean.length,
      duplicatesCollapsed: duplicates,
      skippedInvalid: skipped,
      wouldGrant: 0,
    });
    return;
  }

  if (clean.length === 0) {
    log.warn('nothing to import', {});
    return;
  }

  // Load the DB only now — this validates env and opens a pool.
  const { db, pool } = await import('../src/db/index.js');

  try {
    await importUsers(db, clean);
    log.info('legacy import finished', {
      usersImported: clean.length,
      grantsCreated: 0,
      skippedInvalid: skipped,
      duplicatesCollapsed: duplicates,
    });
  } finally {
    await pool.end().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error('legacy import failed', { error: err });
    process.exit(1);
  });
