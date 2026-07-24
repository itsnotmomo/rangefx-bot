import { and, count, eq, exists, isNotNull, isNull, notExists, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accessGrants, users } from '../db/schema.js';

/**
 * Broadcast audiences. Definitions lean on the access layer (the source of
 * truth for membership) plus the funnel's paid_at:
 *
 *   all      — everyone who hasn't blocked the bot.
 *   leads    — never paid AND never held a group grant (pure prospects,
 *              including imported leads).
 *   churned  — paid before or once held access, but no live grant now.
 *   active   — currently holds a live group grant (Stripe or legacy).
 *
 * Users with blocked_at set are excluded from every audience.
 */

export type AudienceKey = 'all' | 'leads' | 'churned' | 'active';

export const AUDIENCE_LABEL: Record<AudienceKey, string> = {
  all: 'All users',
  leads: 'Leads — never paid',
  churned: 'Churned',
  active: 'Active members',
};

function liveGrant() {
  return db
    .select({ one: sql`1` })
    .from(accessGrants)
    .where(and(eq(accessGrants.telegramUserId, users.telegramUserId), isNull(accessGrants.revokedAt)));
}

function anyGrant() {
  return db
    .select({ one: sql`1` })
    .from(accessGrants)
    .where(eq(accessGrants.telegramUserId, users.telegramUserId));
}

function revokedGrant() {
  return db
    .select({ one: sql`1` })
    .from(accessGrants)
    .where(and(eq(accessGrants.telegramUserId, users.telegramUserId), isNotNull(accessGrants.revokedAt)));
}

function audienceWhere(key: AudienceKey): SQL | undefined {
  const notBlocked = isNull(users.blockedAt);
  switch (key) {
    case 'all':
      return notBlocked;
    case 'active':
      return and(notBlocked, exists(liveGrant()));
    case 'leads':
      return and(notBlocked, isNull(users.paidAt), notExists(anyGrant()));
    case 'churned':
      return and(
        notBlocked,
        notExists(liveGrant()),
        or(isNotNull(users.paidAt), exists(revokedGrant())),
      );
  }
}

export async function audienceCount(key: AudienceKey): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users).where(audienceWhere(key));
  return row?.value ?? 0;
}

export async function audienceCounts(): Promise<Record<AudienceKey, number>> {
  const keys: AudienceKey[] = ['all', 'leads', 'churned', 'active'];
  const values = await Promise.all(keys.map((k) => audienceCount(k)));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<AudienceKey, number>;
}

/** Recipient ids for an audience, in stable id order. */
export async function audienceIds(key: AudienceKey): Promise<bigint[]> {
  const rows = await db
    .select({ id: users.telegramUserId })
    .from(users)
    .where(audienceWhere(key))
    .orderBy(users.telegramUserId);
  return rows.map((r) => r.id);
}
