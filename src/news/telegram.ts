import { type Api } from 'grammy';
import { log } from '../util/logger.js';
import { safeCall, type SafeResult } from '../telegram/safe.js';
import { isQuietHour, newsChatId, newsConfig, newsTopicId } from './config.js';
import { type NewsSettings } from './schema.js';

/**
 * Outbound delivery for the news topic.
 *
 * Wraps the existing safeCall() error boundary rather than replacing it, and
 * adds the two things a scheduled poster needs that a user-triggered reply does
 * not: 429 backoff that respects Telegram's own retry_after, and quiet-hour
 * muting.
 */

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a Telegram call on rate limiting.
 *
 * Telegram tells us exactly how long to wait via retry_after; we honour that
 * when present and fall back to exponential backoff when it is not. Non-429
 * failures return immediately — retrying a 400 just burns time.
 */
async function withRateLimitRetry<T>(label: string, fn: () => Promise<T>): Promise<SafeResult<T>> {
  let last: SafeResult<T> = { ok: false, blocked: false, error: 'not attempted' };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    last = await safeCall(label, fn);
    if (last.ok) return last;

    const rateLimited = last.retryAfter !== undefined;
    const transient = last.error === 'network_error';
    if (!rateLimited && !transient) return last;
    if (attempt === MAX_ATTEMPTS - 1) break;

    const waitMs = last.retryAfter !== undefined ? last.retryAfter * 1000 : BASE_BACKOFF_MS * 2 ** attempt;
    log.warn('news send throttled, backing off', { label, attempt: attempt + 1, waitMs, retryAfter: last.retryAfter });
    await sleep(waitMs);
  }

  return last;
}

/**
 * Whether notifications should be silenced right now.
 *
 * Settings columns win over env so quiet hours can be changed without a
 * redeploy; env is the fallback. Quiet hours never suppress a message — a
 * release the desk slept through still has to be in the topic afterwards.
 */
export function shouldSilence(settings: NewsSettings, at: Date = new Date()): boolean {
  const start = settings.quietStart ?? newsConfig.quietStart;
  const end = settings.quietEnd ?? newsConfig.quietEnd;
  return isQuietHour(start, end, at);
}

/**
 * Post to the news topic. Returns the Telegram message id, or null if the send
 * failed — callers use null to release their delivery claim so a later tick
 * can retry.
 */
export async function sendNews(api: Api, text: string, silent: boolean): Promise<number | null> {
  const chatId = newsChatId();
  if (chatId === null) return null;

  const topicId = newsTopicId();
  const res = await withRateLimitRetry('news.sendMessage', () =>
    api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      // The key is OMITTED, not sent as undefined, when targeting General.
      // Passing message_thread_id: 1 (or an explicit undefined) is the
      // unreliable way to hit a forum's General topic; leaving the field out
      // entirely is the way that works.
      ...(topicId !== undefined ? { message_thread_id: topicId } : {}),
      disable_notification: silent,
      link_preview_options: { is_disabled: true },
    }),
  );

  if (!res.ok) {
    log.error('news send failed', { error: res.error, chatId, topicId: topicId ?? 'general' });
    return null;
  }
  return res.value.message_id;
}

/**
 * Edit a previously posted message in place — how a release post becomes the
 * result post without adding a third message to the topic.
 */
export async function editNews(api: Api, messageId: number, text: string): Promise<boolean> {
  const chatId = newsChatId();
  if (chatId === null) return false;

  const res = await withRateLimitRetry('news.editMessageText', () =>
    api.editMessageText(chatId, messageId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }),
  );

  if (res.ok) return true;
  // Identical content is a no-op, not a failure — treat it as delivered.
  if (res.error.includes('message is not modified')) return true;

  log.error('news edit failed', { error: res.error, chatId, messageId });
  return false;
}
