import { and, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { followups, users } from '../db/schema.js';

/**
 * Funnel tracking + the lead follow-up engine.
 *
 * Funnel state lives as first-touch timestamps on `users`:
 *   started_at -> viewed_plans_at -> opened_checkout_at -> paid_at
 *
 * Follow-ups: when a user views plans or opens checkout without having paid,
 * two touches are scheduled — stage 1 at +1 hour, stage 2 at +24 hours — and
 * NOTHING further, ever. The unique (user, stage) index means later funnel
 * activity never reschedules or duplicates a touch, and paying deletes any
 * unsent rows. A sent row is never retried: sent is sent, delivered or not.
 */

const HOUR_MS = 60 * 60 * 1000;

export const FOLLOWUP_STAGES = [
  { stage: 1, delayMs: 1 * HOUR_MS },
  { stage: 2, delayMs: 24 * HOUR_MS },
] as const;

// ---- Funnel marks (first touch wins) --------------------------------------

async function markFirst(telegramUserId: bigint, column: 'startedAt' | 'viewedPlansAt' | 'openedCheckoutAt' | 'paidAt'): Promise<void> {
  await db
    .update(users)
    .set({ [column]: sql`COALESCE(${users[column]}, now())` })
    .where(eq(users.telegramUserId, telegramUserId));
}

export async function markStarted(telegramUserId: bigint): Promise<void> {
  await markFirst(telegramUserId, 'startedAt');
}

export async function markViewedPlans(telegramUserId: bigint): Promise<void> {
  await markFirst(telegramUserId, 'viewedPlansAt');
}

export async function markOpenedCheckout(telegramUserId: bigint): Promise<void> {
  await markFirst(telegramUserId, 'openedCheckoutAt');
}

/** Record payment and cancel any follow-up that hasn't gone out yet. */
export async function markPaid(telegramUserId: bigint): Promise<void> {
  await markFirst(telegramUserId, 'paidAt');
  await cancelPendingFollowups(telegramUserId);
}

// ---- Follow-up scheduling --------------------------------------------------

/**
 * Schedule both touches for a user who just entered the funnel. No-op if the
 * user has paid or if rows already exist (the first funnel touch fixes the
 * clock — browsing plans again later never resets it).
 */
export async function scheduleFollowups(telegramUserId: bigint): Promise<void> {
  const [u] = await db
    .select({ paidAt: users.paidAt })
    .from(users)
    .where(eq(users.telegramUserId, telegramUserId))
    .limit(1);
  if (!u || u.paidAt) return;

  const now = Date.now();
  await db
    .insert(followups)
    .values(
      FOLLOWUP_STAGES.map((s) => ({
        telegramUserId,
        stage: s.stage,
        scheduledAt: new Date(now + s.delayMs),
      })),
    )
    .onConflictDoNothing();
}

export async function cancelPendingFollowups(telegramUserId: bigint): Promise<void> {
  await db
    .delete(followups)
    .where(and(eq(followups.telegramUserId, telegramUserId), isNull(followups.sentAt)));
}

export interface DueFollowup {
  id: number;
  telegramUserId: bigint;
  stage: number;
  paidAt: Date | null;
}

/** Unsent follow-ups whose time has come, oldest first. */
export async function dueFollowups(limit = 500): Promise<DueFollowup[]> {
  return db
    .select({
      id: followups.id,
      telegramUserId: followups.telegramUserId,
      stage: followups.stage,
      paidAt: users.paidAt,
    })
    .from(followups)
    .innerJoin(users, eq(users.telegramUserId, followups.telegramUserId))
    .where(and(isNull(followups.sentAt), lte(followups.scheduledAt, new Date())))
    .orderBy(followups.scheduledAt)
    .limit(limit);
}

/** Mark a touch as handled. Called even when delivery failed — never retried. */
export async function markFollowupSent(id: number): Promise<void> {
  await db.update(followups).set({ sentAt: new Date() }).where(eq(followups.id, id));
}

// ---- Stats -----------------------------------------------------------------

export interface FunnelCounts {
  started: number;
  viewedPlans: number;
  openedCheckout: number;
  paid: number;
}

/** Distinct users per funnel stage (COUNT of the non-null first-touch columns). */
export async function funnelCounts(): Promise<FunnelCounts> {
  const [row] = await db
    .select({
      started: count(users.startedAt),
      viewedPlans: count(users.viewedPlansAt),
      openedCheckout: count(users.openedCheckoutAt),
      paid: count(users.paidAt),
    })
    .from(users);
  return row ?? { started: 0, viewedPlans: 0, openedCheckout: 0, paid: 0 };
}

export interface SourceBreakdownRow {
  source: string | null;
  total: number;
  paid: number;
}

/** Users and payers grouped by acquisition source, biggest first. */
export async function acquisitionBreakdown(): Promise<SourceBreakdownRow[]> {
  return db
    .select({
      source: users.acquisitionSource,
      total: count(),
      paid: count(users.paidAt),
    })
    .from(users)
    .groupBy(users.acquisitionSource)
    .orderBy(desc(count()));
}
