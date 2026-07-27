import { type Api } from 'grammy';
import { config } from '../config/index.js';
import { markBlocked } from '../services/users.js';
import {
  claimBatch,
  contentOf,
  failureBreakdown,
  markFailed,
  markSent,
  progressOf,
  setStatus,
  type BroadcastContent,
  type BroadcastProgress,
} from '../services/broadcasts.js';
import { type Broadcast } from '../db/schema.js';
import { safeCall, safeSendMessage, type SafeResult } from '../telegram/safe.js';
import { log } from '../util/logger.js';

export { type BroadcastContent, type BroadcastProgress };

/**
 * The broadcast runner.
 *
 * It is deliberately NOT awaited by the Telegram webhook handler. grammY's
 * webhookCallback races every update against timeoutMilliseconds (10s by
 * default) and rejects when the timer wins; Express 4 discards that rejection
 * and Node kills the process. A 11,408-recipient send is ~7.6 minutes of work,
 * so awaiting it inside the handler was a guaranteed crash at the ten-second
 * mark, not a probabilistic one. `startBroadcast` therefore returns immediately
 * and the loop runs detached, driven by broadcast_sends rather than memory.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How often progress is logged and onProgress fires (every N processed). */
const PROGRESS_EVERY = 500;

/** Recipients fetched per claim query. */
const BATCH_SIZE = 500;

/** Max attempts for one recipient when Telegram answers 429. */
const MAX_RATE_LIMIT_RETRIES = 5;

/** Fallback pause when a 429 arrives without a retry_after parameter. */
const DEFAULT_RETRY_AFTER_SECONDS = 3;

/**
 * One broadcast at a time per process. The runner is detached, so without this
 * a second confirmation (or a resume issued while a run is live) would
 * interleave two loops over the same rows.
 */
let activeRun: number | null = null;

export function activeBroadcastId(): number | null {
  return activeRun;
}

/** Sends per second for this payload kind. */
export function rateFor(content: BroadcastContent): number {
  const perSecond = content.photoFileId ? config.broadcastPhotoPerSecond : config.broadcastPerSecond;
  return Math.max(1, perSecond);
}

/**
 * True when a failure means this recipient can never be reached again, so
 * future broadcasts should skip them and the counts stay honest.
 *
 *   403 — blocked the bot, deactivated, or kicked.
 *   400 — "chat not found" / "user not found" / invalid peer: the account is
 *         gone. Other 400s (bad markup, caption too long) are payload problems
 *         and must NOT retire the recipient.
 */
function isPermanentlyUnreachable(result: { blocked: boolean; code?: number; error: string }): boolean {
  if (result.blocked || result.code === 403) return true;
  if (result.code !== 400) return false;
  const d = result.error.toLowerCase();
  return d.includes('chat not found') || d.includes('user not found') || d.includes('peer_id_invalid');
}

function deliver(api: Api, id: bigint, content: BroadcastContent): Promise<SafeResult<unknown>> {
  return content.photoFileId
    ? safeCall('sendPhoto', () =>
        // A file_id, not a buffer: Telegram reuses the already-uploaded photo,
        // so nothing is re-uploaded and nothing is held in memory per send.
        api.sendPhoto(Number(id), content.photoFileId!, { caption: content.caption }),
      )
    : safeSendMessage(api, id, content.text ?? '');
}

/**
 * Deliver to one recipient, honouring 429 retry_after. A 429 is a "come back
 * later", never a permanent failure, so the same recipient is retried after the
 * requested pause instead of being written off.
 */
async function deliverWithBackoff(
  api: Api,
  id: bigint,
  content: BroadcastContent,
): Promise<SafeResult<unknown>> {
  let result = await deliver(api, id, content);
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    if (result.ok || result.code !== 429) return result;
    const wait = result.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS;
    log.warn('broadcast rate limited', { telegramUserId: id.toString(), retryAfter: wait, attempt });
    await sleep(wait * 1000);
    result = await deliver(api, id, content);
  }
  return result;
}

/**
 * Run (or resume) a broadcast to completion. Reads its recipients from the
 * broadcast_sends snapshot — never from the audience query, whose row set
 * shrinks as this loop marks users blocked.
 *
 * Every await inside the loop is guarded: sends go through safeCall (which
 * cannot throw), and the bookkeeping writes are wrapped so a transient database
 * error costs one recipient rather than the run.
 */
export async function runBroadcast(
  api: Api,
  broadcast: Broadcast,
  onProgress?: (p: BroadcastProgress) => void,
): Promise<BroadcastProgress> {
  if (activeRun !== null) {
    log.warn('broadcast already running — refusing to start a second', {
      running: activeRun,
      requested: broadcast.id,
    });
    return progressOf(broadcast.id);
  }
  activeRun = broadcast.id;

  const content = contentOf(broadcast);
  const perSecond = rateFor(content);
  const delayMs = Math.max(0, Math.floor(1000 / perSecond));
  let processed = 0;

  try {
    await setStatus(broadcast.id, 'running', { started: broadcast.startedAt === null });
    const start = await progressOf(broadcast.id);
    log.info('broadcast started', {
      broadcastId: broadcast.id,
      audience: broadcast.audience,
      kind: broadcast.kind,
      perSecond,
      total: start.total,
      alreadySent: start.sent,
      pending: start.pending,
    });

    // Every recipient this run has already delivered to. A row only leaves
    // 'pending' when markSent/markFailed succeeds, so if that write fails the
    // next claimBatch hands the same id back — and re-sending to someone who
    // already received the message is the one unacceptable outcome. This set
    // makes a stalled row cost the run, not a duplicate delivery.
    const attempted = new Set<string>();

    for (;;) {
      const batch = await claimBatch(broadcast.id, BATCH_SIZE);
      if (batch.length === 0) break;

      const repeats = batch.filter((id) => attempted.has(id.toString()));
      if (repeats.length > 0) {
        log.error('broadcast stalled: recipients re-offered after delivery', {
          broadcastId: broadcast.id,
          stalled: repeats.length,
          sample: repeats.slice(0, 5).map(String),
          hint: 'bookkeeping writes are failing; stopping rather than re-sending',
        });
        await setStatus(broadcast.id, 'interrupted', { finished: true });
        return progressOf(broadcast.id);
      }

      for (const id of batch) {
        attempted.add(id.toString());
        const result = await deliverWithBackoff(api, id, content);

        try {
          if (result.ok) {
            await markSent(broadcast.id, id);
          } else {
            await markFailed(broadcast.id, id, result.code ?? null, result.error);
            if (isPermanentlyUnreachable(result)) await markBlocked(id);
          }
        } catch (err) {
          // Bookkeeping failed, not the send. Log and move on — a stuck row is
          // re-read on the next resume, which is the safe direction to fail.
          log.error('broadcast bookkeeping failed', {
            broadcastId: broadcast.id,
            telegramUserId: id.toString(),
            error: err,
          });
        }

        processed++;
        if (processed % PROGRESS_EVERY === 0) {
          const p = await progressOf(broadcast.id);
          log.info('broadcast progress', {
            broadcastId: broadcast.id,
            processed,
            sent: p.sent,
            failed: p.failed,
            pending: p.pending,
            total: p.total,
          });
          // A throwing callback must not abort the run.
          try {
            onProgress?.(p);
          } catch (err) {
            log.warn('broadcast progress callback failed', { broadcastId: broadcast.id, error: err });
          }
        }
        if (delayMs) await sleep(delayMs);
      }
    }

    const final = await progressOf(broadcast.id);
    await setStatus(broadcast.id, 'completed', { finished: true });
    log.info('broadcast finished', { broadcastId: broadcast.id, ...final });
    return final;
  } finally {
    activeRun = null;
  }
}

/** "403 — blocked or deactivated: 812" lines for the completion summary. */
const CODE_LABEL: Record<number, string> = {
  400: 'bad request / chat not found',
  403: 'blocked or deactivated',
  429: 'rate limited (gave up after retries)',
};

export async function summaryLines(broadcast: Broadcast): Promise<string[]> {
  const p = await progressOf(broadcast.id);
  const attempted = p.sent + p.failed;
  const lines = [
    `Broadcast #${broadcast.id} — ${broadcast.status}`,
    `Audience: ${broadcast.audience} · ${broadcast.kind}`,
    '',
    `Attempted: ${attempted} of ${p.total}`,
    `Sent: ${p.sent}`,
    `Failed: ${p.failed}`,
  ];
  if (p.pending > 0) lines.push(`Not yet attempted: ${p.pending}`);

  const failures = await failureBreakdown(broadcast.id);
  if (failures.length > 0) {
    lines.push('', 'Failures by code:');
    for (const f of failures) {
      const label = f.code === null ? 'network / unknown' : (CODE_LABEL[f.code] ?? 'telegram error');
      lines.push(`  • ${f.code ?? '—'} ${label}: ${f.n}`);
    }
  }
  return lines;
}
