import { type Api } from 'grammy';
import { config } from '../config/index.js';
import { allUserIds } from '../services/users.js';
import { safeSendMessage } from '../telegram/safe.js';
import { log } from '../util/logger.js';

export interface BroadcastProgress {
  total: number;
  sent: number;
  failed: number;
  blocked: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send `text` to every user, throttled to BROADCAST_PER_SECOND to stay within
 * Telegram's global limits. Each send is wrapped: a user who blocked the bot is
 * counted and skipped, never fatal. Built for the ~11.4k legacy list.
 *
 * `onProgress` is called periodically so the caller can update a status message.
 * Returns the final tally.
 */
export async function broadcast(
  api: Api,
  text: string,
  onProgress?: (p: BroadcastProgress) => void,
): Promise<BroadcastProgress> {
  const ids = await allUserIds();
  const delayMs = Math.max(0, Math.floor(1000 / Math.max(1, config.broadcastPerSecond)));
  const progress: BroadcastProgress = { total: ids.length, sent: 0, failed: 0, blocked: 0 };

  log.info('broadcast started', { total: progress.total, perSecond: config.broadcastPerSecond });

  for (let i = 0; i < ids.length; i++) {
    const result = await safeSendMessage(api, ids[i]!, text);
    if (result.ok) {
      progress.sent++;
    } else if (result.blocked) {
      progress.blocked++;
    } else {
      progress.failed++;
      // Respect a 429 by waiting out retry_after before continuing.
      if (result.retryAfter) await sleep(result.retryAfter * 1000);
    }

    if (onProgress && (i % 50 === 0 || i === ids.length - 1)) onProgress(progress);
    if (delayMs) await sleep(delayMs);
  }

  log.info('broadcast finished', { ...progress });
  return progress;
}
