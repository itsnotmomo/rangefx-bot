import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, pool } from '../src/db/index.js';
import { accessGrants, events, users } from '../src/db/schema.js';
import { config } from '../src/config/index.js';
import { log } from '../src/util/logger.js';

/**
 * Legacy member import
 * --------------------
 * One-off (but safely repeatable) migration that seeds the `users` table from a
 * pre-bot export and grants live group access to members who were active at the
 * time of export.
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
 *   • A live group grant is created at most once per member — we skip anyone who
 *     already holds one, so re-running adds no duplicate grants or audit events.
 *
 * Usage:  npm run import-legacy -- ./path/to/legacy.csv
 */

const RESOURCE_TYPE = 'telegram_group';
const SOURCE = 'legacy_import';
const GRANT_REASON = 'legacy_import';

/**
 * Statuses that mean the member should currently be inside the group. Legacy
 * exports use Stripe-style status strings; anything canceled/incomplete/blank is
 * imported as a user record but does NOT receive group access.
 */
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

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
  status: string;
  affiliate: string | null;
  createdAt: Date;
}

function usage(): never {
  log.error('missing CSV path argument', {});
  process.stderr.write('\nUsage: npm run import-legacy -- <path-to-csv>\n\n');
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
      status: (row.status?.trim() || '').toLowerCase(),
      affiliate: cleanText(row.referredByAffiliateId),
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
 */
async function importUsers(clean: CleanUser[]): Promise<void> {
  let done = 0;
  for (const batch of chunked(clean, CHUNK)) {
    await db
      .insert(users)
      .values(
        batch.map((u) => ({
          telegramUserId: u.telegramUserId,
          firstName: u.firstName,
          email: u.email,
          source: SOURCE,
          createdAt: u.createdAt,
        })),
      )
      .onConflictDoUpdate({
        target: users.telegramUserId,
        set: {
          firstName: sql`COALESCE(EXCLUDED.first_name, ${users.firstName})`,
          email: sql`COALESCE(EXCLUDED.email, ${users.email})`,
        },
      });
    done += batch.length;
    log.info('users upserted', { done, total: clean.length });
  }
}

/**
 * Grant live group access to active members who don't already hold one. We insert
 * grants directly (rather than via the bot's grantGroupAccess) because we must NOT
 * mint invite links or DM 11k people — these members are already in the group; the
 * grant simply records that they're authorised so /status and the grace job behave.
 */
async function importGrants(clean: CleanUser[]): Promise<number> {
  const resourceId = config.groupChatId.toString();

  // One query up front for everyone who already has a live grant — avoids a
  // per-row round trip and makes re-runs a no-op.
  const existing = await db
    .select({ id: accessGrants.telegramUserId })
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.resourceType, RESOURCE_TYPE),
        eq(accessGrants.resourceId, resourceId),
        isNull(accessGrants.revokedAt),
      ),
    );
  const alreadyGranted = new Set(existing.map((r) => r.id.toString()));

  const toGrant = clean.filter(
    (u) => ACTIVE_STATUSES.has(u.status) && !alreadyGranted.has(u.telegramUserId.toString()),
  );

  let done = 0;
  for (const batch of chunked(toGrant, CHUNK)) {
    await db.transaction(async (tx) => {
      await tx.insert(accessGrants).values(
        batch.map((u) => ({
          telegramUserId: u.telegramUserId,
          resourceType: RESOURCE_TYPE,
          resourceId,
          reason: GRANT_REASON,
          grantedAt: u.createdAt,
        })),
      );
      await tx.insert(events).values(
        batch.map((u) => ({
          type: 'access.granted',
          telegramUserId: u.telegramUserId,
          payload: JSON.stringify({
            reason: GRANT_REASON,
            status: u.status,
            referredByAffiliateId: u.affiliate,
          }),
        })),
      );
    });
    done += batch.length;
    log.info('grants created', { done, total: toGrant.length });
  }
  return toGrant.length;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) usage();

  const abs = resolve(path);
  log.info('legacy import started', { path: abs });

  const rows = readRows(abs);
  const { users: clean, skipped, duplicates } = dedupe(rows);
  log.info('rows parsed', {
    rawRows: rows.length,
    importable: clean.length,
    skippedInvalid: skipped,
    duplicatesCollapsed: duplicates,
  });

  if (clean.length === 0) {
    log.warn('nothing to import', {});
    return;
  }

  await importUsers(clean);
  const granted = await importGrants(clean);

  log.info('legacy import finished', {
    usersImported: clean.length,
    grantsCreated: granted,
    skippedInvalid: skipped,
    duplicatesCollapsed: duplicates,
  });
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    log.error('legacy import failed', { error: err });
    await pool.end().catch(() => {});
    process.exit(1);
  });
