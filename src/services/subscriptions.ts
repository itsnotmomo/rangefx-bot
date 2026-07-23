import { and, count, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions, type Subscription } from '../db/schema.js';
import { PRICE_ID_TO_PLAN } from '../config/index.js';

export interface UpsertSubscriptionInput {
  telegramUserId: bigint;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/** Insert or update a subscription keyed on the Stripe subscription id. */
export async function upsertSubscription(input: UpsertSubscriptionInput): Promise<Subscription> {
  const plan = input.stripePriceId ? PRICE_ID_TO_PLAN[input.stripePriceId] ?? null : null;
  const [row] = await db
    .insert(subscriptions)
    .values({
      telegramUserId: input.telegramUserId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripePriceId: input.stripePriceId,
      plan,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        stripePriceId: input.stripePriceId,
        plan,
        status: input.status,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row!;
}

export async function getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | undefined> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  return row;
}

/** The most recent subscription for a user (what /status displays). */
export async function getLatestSubscription(telegramUserId: bigint): Promise<Subscription | undefined> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.telegramUserId, telegramUserId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row;
}

export async function updateSubscriptionStatus(
  stripeSubscriptionId: string,
  status: string,
): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

export async function updatePeriodEnd(stripeSubscriptionId: string, periodEnd: Date | null): Promise<void> {
  await db
    .update(subscriptions)
    .set({ currentPeriodEnd: periodEnd, updatedAt: sql`now()` })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

/** Count of subscriptions grouped by status — used by /stats. */
export async function subscriptionStatusCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: subscriptions.status, value: count() })
    .from(subscriptions)
    .groupBy(subscriptions.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.value;
  return out;
}

/** Active subscriptions grouped by plan key — used by /stats revenue lines. */
export async function activeCountsByPlan(): Promise<Record<string, number>> {
  const rows = await db
    .select({ plan: subscriptions.plan, value: count() })
    .from(subscriptions)
    .where(eq(subscriptions.status, 'active'))
    .groupBy(subscriptions.plan);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.plan) out[r.plan] = r.value;
  return out;
}

/**
 * Subscriptions stuck in `past_due` whose period ended more than `graceDays`
 * ago — candidates for removal by the grace-period job.
 */
export async function pastDueBeyondGrace(cutoff: Date): Promise<Subscription[]> {
  return db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.status, 'past_due'), lt(subscriptions.currentPeriodEnd, cutoff)));
}

/** All currently past_due subscriptions (for day-1 warnings). */
export async function allPastDue(): Promise<Subscription[]> {
  return db.select().from(subscriptions).where(eq(subscriptions.status, 'past_due'));
}
