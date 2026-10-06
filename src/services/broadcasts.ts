import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { type MessageEntity } from 'grammy/types';
import { db } from '../db/index.js';
import { broadcastSends, broadcasts, type Broadcast } from '../db/schema.js';
import { type AudienceKey } from './audience.js';

/**
 * Broadcast persistence.
 *
 * Two invariants this module exists to hold:
 *
 *  1. A confirmed broadcast is created exactly once. `idempotency_key` carries
 *     the confirming Telegram update id and is UNIQUE, so a webhook retry of
 *     that confirmation returns the EXISTING row instead of starting a second
 *     run. In-memory flow state cannot do this — it is empty after a restart,
 *     which is precisely when Telegram retries.
 *
 *  2. The recipient set is frozen at enqueue time. `snapshotAudience` writes
 *     every id into broadcast_sends once; the runner and any later resume read
 *     only from there. Re-running the audience query would return a different
 *     set, because the runner marks users blocked as it goes and every audience
 *     predicate excludes blocked users.
 */

export interface BroadcastContent {
  text?: string;
  photoFileId?: string;
  caption?: string;
  /**
   * Formatting: entities of `text`, or of `caption` for a photo. Stored in its
   * own column (broadcasts.entities), not in the content JSON.
   */
  entities?: MessageEntity[];
}

export interface CreateBroadcastInput {
  audience: AudienceKey;
  content: BroadcastContent;
  createdBy: bigint;
  /** Stable per confirming update, so a retry cannot start a second run. */
  idempotencyKey: string;
}

export interface CreateBroadcastResult {
  broadcast: Broadcast;
  /** False when this key was already used — i.e. a duplicate confirmation. */
  created: boolean;
}

/** Parse the stored JSON payload back into content, with its entities. Never throws. */
export function contentOf(broadcast: Broadcast): BroadcastContent {
  let parsed: BroadcastContent = {};
  try {
    const raw = JSON.parse(broadcast.content) as BroadcastContent;
    if (typeof raw === 'object' && raw !== null) parsed = raw;
  } catch {
    // fall through with empty content
  }
  const entities = Array.isArray(broadcast.entities) ? broadcast.entities : undefined;
  return { text: parsed.text, photoFileId: parsed.photoFileId, caption: parsed.caption, entities };
}

/**
 * Create the broadcast row, or return the existing one if this idempotency key
 * has already been used. `created: false` means a duplicate confirmation — the
 * caller must NOT start a run.
 */
export async function createBroadcast(input: CreateBroadcastInput): Promise<CreateBroadcastResult> {
  const { entities, ...payload } = input.content;
  const [row] = await db
    .insert(broadcasts)
    .values({
      audience: input.audience,
      kind: input.content.photoFileId ? 'photo' : 'text',
      content: JSON.stringify(payload),
      entities: entities && entities.length > 0 ? entities : null,
      status: 'running',
      createdBy: input.createdBy,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: broadcasts.idempotencyKey })
    .returning();

  if (row) return { broadcast: row, created: true };

  // Conflict: the same confirmation arrived twice. Hand back the original.
  const [existing] = await db
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.idempotencyKey, input.idempotencyKey))
    .limit(1);
  return { broadcast: existing!, created: false };
}

/**
 * Freeze the audience into broadcast_sends. Idempotent via the unique index, so
 * a partially-applied snapshot can be re-run safely. Returns the row count.
 */
export async function snapshotAudience(broadcastId: number, ids: bigint[]): Promise<number> {
  const CHUNK = 1000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    await db
      .insert(broadcastSends)
      .values(slice.map((id) => ({ broadcastId, telegramUserId: id, status: 'pending' })))
      .onConflictDoNothing({ target: [broadcastSends.broadcastId, broadcastSends.telegramUserId] });
  }
  await db
    .update(broadcasts)
    .set({ total: ids.length, updatedAt: sql`now()` })
    .where(eq(broadcasts.id, broadcastId));
  return ids.length;
}

/**
 * The next batch of unsent recipients, in stable id order.
 *
 * A plain ordered SELECT rather than an atomic claim: the runner enforces one
 * active broadcast per process, and the service runs as a single Railway
 * instance. Each row is marked sent/failed immediately after its send, so a
 * crash re-reads only genuinely unsent rows.
 */
export async function claimBatch(broadcastId: number, limit: number): Promise<bigint[]> {
  const rows = await db
    .select({ id: broadcastSends.telegramUserId })
    .from(broadcastSends)
    .where(and(eq(broadcastSends.broadcastId, broadcastId), eq(broadcastSends.status, 'pending')))
    .orderBy(asc(broadcastSends.telegramUserId))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function markSent(broadcastId: number, telegramUserId: bigint): Promise<void> {
  await db
    .update(broadcastSends)
    .set({ status: 'sent', sentAt: sql`now()`, errorCode: null, error: null })
    .where(
      and(eq(broadcastSends.broadcastId, broadcastId), eq(broadcastSends.telegramUserId, telegramUserId)),
    );
}

export async function markFailed(
  broadcastId: number,
  telegramUserId: bigint,
  errorCode: number | null,
  error: string,
): Promise<void> {
  await db
    .update(broadcastSends)
    .set({ status: 'failed', errorCode, error: error.slice(0, 500), sentAt: sql`now()` })
    .where(
      and(eq(broadcastSends.broadcastId, broadcastId), eq(broadcastSends.telegramUserId, telegramUserId)),
    );
}

export interface BroadcastProgress {
  total: number;
  sent: number;
  failed: number;
  pending: number;
}

export async function progressOf(broadcastId: number): Promise<BroadcastProgress> {
  const rows = await db
    .select({ status: broadcastSends.status, value: count() })
    .from(broadcastSends)
    .where(eq(broadcastSends.broadcastId, broadcastId))
    .groupBy(broadcastSends.status);
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = r.value;
  const sent = by.sent ?? 0;
  const failed = by.failed ?? 0;
  const pending = by.pending ?? 0;
  return { total: sent + failed + pending, sent, failed, pending };
}

/** Failure counts grouped by Telegram error code, for the completion summary. */
export async function failureBreakdown(broadcastId: number): Promise<{ code: number | null; n: number }[]> {
  const rows = await db
    .select({ code: broadcastSends.errorCode, value: count() })
    .from(broadcastSends)
    .where(and(eq(broadcastSends.broadcastId, broadcastId), eq(broadcastSends.status, 'failed')))
    .groupBy(broadcastSends.errorCode);
  return rows.map((r) => ({ code: r.code, n: r.value })).sort((a, b) => b.n - a.n);
}

export async function getBroadcast(id: number): Promise<Broadcast | undefined> {
  const [row] = await db.select().from(broadcasts).where(eq(broadcasts.id, id)).limit(1);
  return row;
}

export async function latestBroadcast(): Promise<Broadcast | undefined> {
  const [row] = await db.select().from(broadcasts).orderBy(desc(broadcasts.id)).limit(1);
  return row;
}

/** Broadcasts left mid-flight by a crash or a deploy restart. */
export async function runningBroadcasts(): Promise<Broadcast[]> {
  return db.select().from(broadcasts).where(eq(broadcasts.status, 'running')).orderBy(asc(broadcasts.id));
}

export async function interruptedBroadcasts(): Promise<Broadcast[]> {
  return db.select().from(broadcasts).where(eq(broadcasts.status, 'interrupted')).orderBy(asc(broadcasts.id));
}

export async function setStatus(
  id: number,
  status: 'running' | 'completed' | 'interrupted' | 'cancelled',
  opts?: { started?: boolean; finished?: boolean },
): Promise<void> {
  await db
    .update(broadcasts)
    .set({
      status,
      updatedAt: sql`now()`,
      ...(opts?.started ? { startedAt: sql`now()` } : {}),
      ...(opts?.finished ? { finishedAt: sql`now()` } : {}),
    })
    .where(eq(broadcasts.id, id));
}
