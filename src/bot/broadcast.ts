import { type Api } from 'grammy';
import { config } from '../config/index.js';
import { markBlocked, type UnreachableReason } from '../services/users.js';
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
import { RateLimiter, runPool } from '../util/rate-limiter.js';
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

/**
 * The global ceiling, shared by the whole pool. Photos and text run at the same
 * rate: the limiter governs combined output, so a payload-specific rate would
 * only lower a run that is already well inside Telegram's limits.
 */
export function broadcastRate(): number {
  return Math.max(1, config.broadcastPerSecond);
}

export function broadcastConcurrency(): number {
  return Math.max(1, config.broadcastConcurrency);
}

/**
 * Why this failure retires the recipient, or null if it doesn't.
 *
 *   'blocked'  403 — blocked the bot, deactivated, or kicked. Reversible: they
 *                    re-enter every audience the moment they message us again.
 *   'deleted'  400 "chat not found" / "user not found" / invalid peer — the
 *                    account is gone.
 *
 * Other 400s (bad markup, caption too long) are payload faults, not recipient
 * faults, and must NOT retire anyone.
 */
function unreachableReasonOf(
  result: { blocked: boolean; code?: number; error: string },
): UnreachableReason | null {
  if (result.blocked || result.code === 403) return 'blocked';
  if (result.code !== 400) return null;
  const d = result.error.toLowerCase();
  const gone = d.includes('chat not found') || d.includes('user not found') || d.includes('peer_id_invalid');
  return gone ? 'deleted' : null;
}

/**
 * Send broadcast content to one chat. Formatting travels as entities /
 * caption_entities only — parse_mode is deliberately never set, so the text is
 * sent verbatim with nothing to escape. Also used for the admin preview, so the
 * preview is byte-for-byte what recipients get.
 */
export function deliver(api: Api, id: bigint | number, content: BroadcastContent): Promise<SafeResult<unknown>> {
  return content.photoFileId
    ? safeCall('sendPhoto', () =>
        // A file_id, not a buffer: Telegram reuses the already-uploaded photo,
        // so nothing is re-uploaded and nothing is held in memory per send.
        api.sendPhoto(Number(id), content.photoFileId!, {
          caption: content.caption,
          caption_entities: content.entities,
        }),
      )
    : safeSendMessage(api, id, content.text ?? '', { entities: content.entities });
}

/**
 * Deliver to one recipient, honouring 429 retry_after.
 *
 * The backoff is registered on the shared limiter, never slept locally: a 429
 * means Telegram is rate-limiting the BOT, so pausing only the worker that saw
 * it would leave the other workers hammering an endpoint that has already said
 * stop — the one way a pool behaves worse than a sequential loop. Registering
 * the pause and looping means the retry waits for free, inside `acquire`, and
 * every other worker waits with it.
 */
async function deliverWithBackoff(
  api: Api,
  id: bigint,
  content: BroadcastContent,
  limiter: RateLimiter,
): Promise<SafeResult<unknown>> {
  for (let attempt = 0; ; attempt++) {
    await limiter.acquire();
    const result = await deliver(api, id, content);
    if (result.ok || result.code !== 429) return result;
    if (attempt >= MAX_RATE_LIMIT_RETRIES) return result;

    const wait = result.retryAfter ?? DEFAULT_RETRY_AFTER_SECONDS;
    limiter.pauseFor(wait);
    log.warn('broadcast rate limited — pausing every worker', {
      telegramUserId: id.toString(),
      retryAfter: wait,
      attempt: attempt + 1,
    });
  }
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
  const perSecond = broadcastRate();
  const concurrency = broadcastConcurrency();
  // One limiter for the whole run: it paces the pool as a unit and carries the
  // global 429 backoff that every worker observes.
  const limiter = new RateLimiter(perSecond);
  let processed = 0;

  try {
    await setStatus(broadcast.id, 'running', { started: broadcast.startedAt === null });
    const start = await progressOf(broadcast.id);
    log.info('broadcast started', {
      broadcastId: broadcast.id,
      audience: broadcast.audience,
      kind: broadcast.kind,
      perSecond,
      concurrency,
      total: start.total,
      alreadySent: start.sent,
      pending: start.pending,
      etaSeconds: Math.round(start.pending / perSecond),
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

      // The batch is worked by a bounded pool rather than one at a time. The
      // sequential loop cost delayMs PLUS the Telegram round trip per
      // recipient, so real throughput was 1/(delay + latency) — about 5.4/sec
      // against a configured 25, a ceiling the structure could not reach.
      // Concurrency hides the latency; the limiter still caps combined output.
      await runPool(
        batch,
        concurrency,
        async (id) => {
          attempted.add(id.toString());
          const result = await deliverWithBackoff(api, id, content, limiter);

          try {
            if (result.ok) {
              await markSent(broadcast.id, id);
            } else {
              await markFailed(broadcast.id, id, result.code ?? null, result.error);
              const reason = unreachableReasonOf(result);
              if (reason) await markBlocked(id, reason);
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
              pausedMs: limiter.pausedForMs(),
            });
            // A throwing callback must not abort the run.
            try {
              onProgress?.(p);
            } catch (err) {
              log.warn('broadcast progress callback failed', { broadcastId: broadcast.id, error: err });
            }
          }
        },
        // runPool already isolates a throwing worker; this records it. Nothing
        // above should throw, so reaching here is a bug worth seeing.
        (err, id) =>
          log.error('broadcast worker threw', {
            broadcastId: broadcast.id,
            telegramUserId: String(id),
            error: err,
          }),
      );
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
