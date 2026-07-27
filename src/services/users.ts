import { count, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, type User } from '../db/schema.js';
import { log } from '../util/logger.js';

export interface UpsertUserInput {
  telegramUserId: bigint;
  telegramUsername?: string | null;
  firstName?: string | null;
  email?: string | null;
  stripeCustomerId?: string | null;
  source?: 'legacy_import' | 'bot';
  /** Deep-link payload from /start. Only the FIRST value ever seen is kept. */
  acquisitionSource?: string | null;
  /**
   * Set ONLY when this upsert was caused by genuine inbound Telegram activity
   * (a /start, a menu tap, a support message). Such a message is proof the
   * account exists and is reachable, so it clears any unreachable mark.
   *
   * Stripe webhooks must leave this false: a renewal invoice says a card
   * charged, not that the bot is unblocked in Telegram. Clearing there
   * resurrected paying members who had genuinely blocked us, put them back in
   * every audience, and spent a send slot per broadcast on a 403 that simply
   * re-marked them.
   */
  clearBlocked?: boolean;
}

/** 403 — reversible. 400 "chat not found" — the account is gone. */
export type UnreachableReason = 'blocked' | 'deleted';

/**
 * Insert or update a user keyed on telegram_user_id. On conflict we COALESCE so
 * a fresh non-null value wins but a null never blanks out something we already
 * learned elsewhere (e.g. an email captured at checkout survives a later /start).
 */
export async function upsertUser(input: UpsertUserInput): Promise<User> {
  // Clear BEFORE the upsert so the row we return reflects the cleared state.
  // A no-op (zero rows) for the overwhelmingly common case of a reachable user.
  if (input.clearBlocked) await clearUnreachable(input.telegramUserId);

  const [row] = await db
    .insert(users)
    .values({
      telegramUserId: input.telegramUserId,
      telegramUsername: input.telegramUsername ?? null,
      firstName: input.firstName ?? null,
      email: input.email ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
      source: input.source ?? 'bot',
      acquisitionSource: input.acquisitionSource ?? null,
    })
    .onConflictDoUpdate({
      target: users.telegramUserId,
      set: {
        telegramUsername: sql`COALESCE(EXCLUDED.telegram_username, ${users.telegramUsername})`,
        firstName: sql`COALESCE(EXCLUDED.first_name, ${users.firstName})`,
        email: sql`COALESCE(EXCLUDED.email, ${users.email})`,
        stripeCustomerId: sql`COALESCE(EXCLUDED.stripe_customer_id, ${users.stripeCustomerId})`,
        // Attribution: the FIRST source sticks — argument order is reversed on purpose.
        acquisitionSource: sql`COALESCE(${users.acquisitionSource}, EXCLUDED.acquisition_source)`,
        // blocked_at is deliberately NOT touched here. It used to be blanked on
        // every upsert, which meant a Stripe renewal silently un-blocked a user
        // who had genuinely blocked the bot. Only clearUnreachable clears it,
        // and only inbound Telegram activity calls it.
      },
    })
    .returning();
  return row!;
}

export async function getUser(telegramUserId: bigint): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.telegramUserId, telegramUserId)).limit(1);
  return row;
}

export async function getUserByStripeCustomer(stripeCustomerId: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.stripeCustomerId, stripeCustomerId)).limit(1);
  return row;
}

export async function setStripeCustomerId(telegramUserId: bigint, stripeCustomerId: string): Promise<void> {
  await db.update(users).set({ stripeCustomerId }).where(eq(users.telegramUserId, telegramUserId));
}

/** All user ids, for broadcast. Returned in id order for stable pagination. */
export async function allUserIds(): Promise<bigint[]> {
  const rows = await db.select({ id: users.telegramUserId }).from(users).orderBy(users.telegramUserId);
  return rows.map((r) => r.id);
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users);
  return row?.value ?? 0;
}

/**
 * A send proved this recipient unreachable — remember it so future broadcasts
 * skip them and the audience counts stay honest.
 *
 *   'blocked'  403: blocked, kicked, or deactivated. Reversible.
 *   'deleted'  400 "chat not found": the account is gone.
 *
 * blocked_at keeps the FIRST timestamp seen. The reason only ever escalates:
 * once an account reads as deleted, a later 403 cannot downgrade it.
 */
export async function markBlocked(
  telegramUserId: bigint,
  reason: UnreachableReason,
): Promise<void> {
  await db
    .update(users)
    .set({
      blockedAt: sql`COALESCE(${users.blockedAt}, now())`,
      unreachableReason: sql`CASE WHEN ${users.unreachableReason} = 'deleted' THEN 'deleted' ELSE ${reason} END`,
    })
    .where(eq(users.telegramUserId, telegramUserId));
}

/**
 * Inbound Telegram activity arrived from this account, so it is reachable —
 * clear any unreachable mark REGARDLESS of reason.
 *
 * A stale 'deleted' is not respected here on purpose: a deleted account cannot
 * send us anything, and Telegram also returns "chat not found" for transient
 * causes. A live message outranks a historical 400. The 'deleted' distinction
 * still matters, but on the paths where nothing demonstrates reachability —
 * those simply never call this.
 *
 * Returns true when a mark was actually cleared, so the caller can log it.
 */
export async function clearUnreachable(telegramUserId: bigint): Promise<boolean> {
  // UPDATE ... FROM a snapshot subquery: the FROM clause is evaluated against
  // the pre-update snapshot, so RETURNING can report the OLD values.
  const result = await db.execute(sql`
    WITH prev AS (
      SELECT telegram_user_id, blocked_at, unreachable_reason
        FROM users
       WHERE telegram_user_id = ${telegramUserId} AND blocked_at IS NOT NULL
    )
    UPDATE users u
       SET blocked_at = NULL, unreachable_reason = NULL
      FROM prev
     WHERE u.telegram_user_id = prev.telegram_user_id
    RETURNING prev.blocked_at AS prev_blocked_at, prev.unreachable_reason AS prev_reason
  `);

  const row = (result.rows as { prev_blocked_at: string | null; prev_reason: string | null }[])[0];
  if (!row) return false;

  log.info('user reachable again — unreachable mark cleared', {
    telegramUserId,
    wasMarkedAt: row.prev_blocked_at,
    previousReason: row.prev_reason ?? 'blocked',
  });
  return true;
}

/**
 * /find: exact id when the query is numeric, otherwise a case-insensitive
 * fragment match on username (with or without @) or first name.
 */
export async function searchUsers(query: string, limit = 8): Promise<User[]> {
  const q = query.trim().replace(/^@/, '');
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const row = await getUser(BigInt(q));
    return row ? [row] : [];
  }
  const fragment = `%${q}%`;
  return db
    .select()
    .from(users)
    .where(or(ilike(users.telegramUsername, fragment), ilike(users.firstName, fragment)))
    .orderBy(users.telegramUserId)
    .limit(limit);
}
