import { GrammyError, HttpError, type Api } from 'grammy';
import { log } from '../util/logger.js';

/**
 * Every outbound Telegram call goes through here. A user who blocked the bot,
 * a deleted account, or a transient network blip must never crash a webhook
 * handler or abort a broadcast — so failures are caught and returned, never
 * thrown.
 */

export type SafeResult<T> =
  | { ok: true; value: T }
  | { ok: false; blocked: boolean; retryAfter?: number; code?: number; error: string };

export async function safeCall<T>(label: string, fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    if (err instanceof GrammyError) {
      // 403 = bot was blocked / kicked / user deactivated. Expected at scale.
      const blocked = err.error_code === 403;
      const retryAfter = err.parameters?.retry_after;
      if (!blocked) {
        log.warn('telegram api error', { label, code: err.error_code, description: err.description, retryAfter });
      }
      return { ok: false, blocked, retryAfter, code: err.error_code, error: err.description };
    }
    if (err instanceof HttpError) {
      log.warn('telegram network error', { label, error: err });
      return { ok: false, blocked: false, error: 'network_error' };
    }
    log.warn('telegram unknown error', { label, error: err });
    return { ok: false, blocked: false, error: String(err) };
  }
}

/** Convenience: send a DM, swallowing failures. Returns whether it was delivered. */
export async function safeSendMessage(
  api: Api,
  chatId: bigint | number,
  text: string,
  extra?: Parameters<Api['sendMessage']>[2],
): Promise<SafeResult<unknown>> {
  return safeCall('sendMessage', () => api.sendMessage(Number(chatId), text, extra));
}
