import { type Api } from 'grammy';
import { log } from '../util/logger.js';
import { safeSendMessage } from '../telegram/safe.js';
import { cadence, newsAdminIds } from './config.js';
import { claimCapNotice, monthToDateRequests } from './repo.js';
import { utcMonthKey, utcMonthStart } from './time.js';

/**
 * Hard monthly request cap.
 *
 * This is billing safety, not telemetry. RapidAPI bills roughly $0.01 per
 * request past the plan allowance and enforces no platform-side ceiling, so a
 * per-minute job stuck in a retry loop is an open-ended charge. The ledger in
 * news_provider_requests counts; this module is what makes it *stop*.
 *
 * Two layers, deliberately:
 *   • quotaAvailable() sits inside each adapter, immediately before the fetch,
 *     so nothing can spend a request by forgetting to ask.
 *   • enforceQuota() sits in the jobs, where an Api is available, so the admin
 *     is told once — the adapter must never DM, or a stuck loop would also be
 *     a message flood.
 */

export interface QuotaState {
  used: number;
  cap: number;
  remaining: number;
  exceeded: boolean;
}

export async function quotaState(provider: string, at: Date = new Date()): Promise<QuotaState> {
  const cap = cadence.monthlyRequestCap;
  const used = await monthToDateRequests(provider, utcMonthStart(at));

  // Only the explicit 'unlimited' / -1 sentinel disables the ceiling. A cap of
  // 0 is a real budget of zero and blocks everything — see parseMonthlyCap.
  if (!Number.isFinite(cap)) {
    return { used, cap, remaining: Number.POSITIVE_INFINITY, exceeded: false };
  }
  return { used, cap, remaining: Math.max(0, cap - used), exceeded: used >= cap };
}

/** Whether the ceiling is switched off entirely (the explicit sentinel). */
export function capDisabled(cap: number): boolean {
  return !Number.isFinite(cap);
}

/**
 * The adapter-level gate. Returns false when the request must not be made.
 *
 * Fails CLOSED: if the ledger cannot be read we refuse the call. An unreadable
 * counter means we do not know what we are spending, and the safe answer to
 * that is silence, not an unmetered API call.
 */
export async function quotaAvailable(provider: string): Promise<boolean> {
  try {
    const state = await quotaState(provider);
    if (state.exceeded) {
      log.error('provider request BLOCKED — monthly cap reached', {
        provider,
        used: state.used,
        cap: state.cap,
      });
      return false;
    }
    return true;
  } catch (err) {
    log.error('quota check failed — blocking the request to be safe', { provider, error: err });
    return false;
  }
}

/**
 * The job-level gate. Returns whether work may proceed, and DMs the admins
 * exactly once per UTC month when the cap first bites.
 *
 * The once-per-month guarantee is a conditional UPDATE on
 * news_settings.cap_notified_month, so concurrent ticks cannot both win it and
 * the flag clears itself when the month key rolls over.
 */
export async function enforceQuota(api: Api, provider: string): Promise<boolean> {
  const state = await quotaState(provider);
  if (!state.exceeded) return true;

  const month = utcMonthKey();
  if (await claimCapNotice(month)) {
    const text = [
      'News module: monthly provider request cap reached.',
      '',
      `Provider:  ${provider}`,
      `Used:      ${state.used} / ${state.cap} (UTC month ${month})`,
      '',
      'All provider calls are now blocked until the 1st. Imports, results and',
      'the T-5/release schedule will go quiet for the rest of the month.',
      '',
      'Raise NEWS_MONTHLY_REQUEST_CAP only if the plan actually covers it —',
      'requests past the allowance are billed per call.',
    ].join('\n');

    for (const adminId of newsAdminIds()) {
      await safeSendMessage(api, adminId, text);
    }
    log.error('monthly provider cap reached — admins notified once', {
      provider,
      used: state.used,
      cap: state.cap,
      month,
    });
  }
  return false;
}
