import { type Api } from 'grammy';
import { config } from '../config/index.js';
import { markBlocked } from '../services/users.js';
import { safeCall, safeSendMessage } from '../telegram/safe.js';
import { log } from '../util/logger.js';

export interface BroadcastContent {
  text?: string;
  photoFileId?: string;
  caption?: string;
}

export interface BroadcastProgress {
  total: number;
  sent: number;
  failed: number;
  blocked: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How often onProgress fires (every N processed recipients, plus the last). */
const PROGRESS_EVERY = 500;

/**
 * Send `content` (text, or photo+caption) to the given recipients, throttled to
 * BROADCAST_PER_SECOND (default ~25/s) to stay within Telegram's global limits.
 *
 * Each send is wrapped: a 403 marks the user blocked (users.blocked_at) so
 * future broadcasts skip them; other failures are counted, never fatal. A 429's
 * retry_after is respected before continuing.
 */
export async function broadcastTo(
  api: Api,
  ids: bigint[],
  content: BroadcastContent,
  onProgress?: (p: BroadcastProgress) => void,
): Promise<BroadcastProgress> {
  const delayMs = Math.max(0, Math.floor(1000 / Math.max(1, config.broadcastPerSecond)));
  const progress: BroadcastProgress = { total: ids.length, sent: 0, failed: 0, blocked: 0 };

  log.info('broadcast started', {
    total: progress.total,
    perSecond: config.broadcastPerSecond,
    kind: content.photoFileId ? 'photo' : 'text',
  });

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const result = content.photoFileId
      ? await safeCall('sendPhoto', () =>
          api.sendPhoto(Number(id), content.photoFileId!, { caption: content.caption }),
        )
      : await safeSendMessage(api, id, content.text ?? '');

    if (result.ok) {
      progress.sent++;
    } else if (result.blocked) {
      progress.blocked++;
      await markBlocked(id);
    } else {
      progress.failed++;
      if (result.retryAfter) await sleep(result.retryAfter * 1000);
    }

    const processed = i + 1;
    if (onProgress && (processed % PROGRESS_EVERY === 0 || processed === ids.length)) {
      onProgress(progress);
    }
    if (delayMs) await sleep(delayMs);
  }

  log.info('broadcast finished', { ...progress });
  return progress;
}
