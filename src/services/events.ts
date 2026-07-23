import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { events } from '../db/schema.js';

/**
 * Append-only audit log. Two uses:
 *  1. Stripe webhook idempotency — `stripe_event_id` is unique, so a duplicate
 *     delivery is swallowed by the DB rather than reprocessed.
 *  2. A record of every access grant/revoke and billing transition.
 */

export interface RecordEventInput {
  type: string;
  stripeEventId?: string | null;
  telegramUserId?: bigint | null;
  payload?: unknown;
}

/**
 * Insert an audit row. Returns `false` if this Stripe event id was already
 * recorded (i.e. a duplicate webhook we should skip). Non-Stripe events (no id)
 * always insert and return `true`.
 */
export async function recordEvent(input: RecordEventInput): Promise<boolean> {
  const inserted = await db
    .insert(events)
    .values({
      type: input.type,
      stripeEventId: input.stripeEventId ?? null,
      telegramUserId: input.telegramUserId ?? null,
      payload: input.payload === undefined ? null : safeStringify(input.payload),
    })
    .onConflictDoNothing({ target: events.stripeEventId })
    .returning({ id: events.id });
  return inserted.length > 0;
}

/** True if a Stripe event id has already been processed. */
export async function eventAlreadyProcessed(stripeEventId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.stripeEventId, stripeEventId))
    .limit(1);
  return row !== undefined;
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}
