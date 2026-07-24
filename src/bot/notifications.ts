import { type Api } from 'grammy';
import { config } from '../config/index.js';
import { countUsers, getUser } from '../services/users.js';
import { classifyUser } from '../services/audience.js';
import { recordEvent } from '../services/events.js';
import { safeSendMessage } from '../telegram/safe.js';
import { log } from '../util/logger.js';

/**
 * Real-time admin notifications for /start events. Two variants:
 *   new       — first real /start ever (users.first_started_at was null)
 *   returning — has started before
 *
 * Flood protection: when more than FLOOD_THRESHOLD start events land within a
 * one-minute window, the notifier switches to per-minute summaries
 * ("47 starts in the last minute — 12 new, 35 returning") and stays there
 * until the rate falls back below the threshold. Launch broadcasts to the
 * 11,400 legacy list spike hundreds of starts per hour; the admin chat must
 * remain readable.
 *
 * Everything here is fire-and-forget from the /start handler and uses the safe
 * Telegram wrapper — a blocked admin or a DB hiccup never touches the user.
 */

export type StartVariant = 'new' | 'returning';

interface StartEventInfo {
  telegramUserId: bigint;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}

const WINDOW_MS = 60_000;
const FLOOD_THRESHOLD = 30;

// Sliding one-minute window of start-event timestamps (any variant).
let recentStarts: number[] = [];
let summaryMode = false;
let pendingNew = 0;
let pendingReturning = 0;
let summaryTimer: NodeJS.Timeout | null = null;

function pruneWindow(now: number): void {
  recentStarts = recentStarts.filter((ts) => now - ts < WINDOW_MS);
}

function nameOf(info: StartEventInfo): string {
  return [info.firstName, info.lastName].filter(Boolean).join(' ') || '—';
}

/** "@alice (Alice Smith)", or just "Alice Smith" when there's no username. */
function subjectOf(info: StartEventInfo): string {
  const name = nameOf(info);
  return info.username ? `@${info.username} (${name})` : name;
}

async function sendToAdmins(api: Api, text: string): Promise<number> {
  let delivered = 0;
  for (const adminId of config.adminUserIds) {
    const res = await safeSendMessage(api, adminId, text);
    if (res.ok) delivered++;
  }
  return delivered;
}

/**
 * Notify admins about a /start. Call fire-and-forget AFTER the user's welcome
 * has been sent; this function never throws into the caller's flow beyond its
 * returned promise.
 */
export async function notifyStart(api: Api, info: StartEventInfo, variant: StartVariant): Promise<void> {
  if (!config.notifyNewUsers) return;

  // Rate accounting + mode switching (synchronous, race-free on the event loop).
  const now = Date.now();
  recentStarts.push(now);
  pruneWindow(now);
  if (!summaryMode && recentStarts.length > FLOOD_THRESHOLD) {
    summaryMode = true;
    log.info('start notifications: flood detected, switching to summaries', {
      lastMinute: recentStarts.length,
    });
    summaryTimer = setInterval(() => {
      flushSummary(api).catch((err) => log.error('start summary failed', { error: err }));
    }, WINDOW_MS);
    summaryTimer.unref();
  }

  if (summaryMode) {
    if (variant === 'new') pendingNew++;
    else pendingReturning++;
    return;
  }

  const text =
    variant === 'new'
      ? await buildNewUserText(info)
      : await buildReturningText(info);

  const delivered = await sendToAdmins(api, text);
  await recordEvent({
    type: 'notify.start',
    telegramUserId: info.telegramUserId,
    payload: { variant, deliveredToAdmins: delivered },
  });
}

// No ID line in either variant — /find covers lookups when needed.

async function buildNewUserText(info: StartEventInfo): Promise<string> {
  const [user, status, total] = await Promise.all([
    getUser(info.telegramUserId),
    classifyUser(info.telegramUserId),
    countUsers(),
  ]);
  return [
    `${subjectOf(info)} just started the bot for the first time`,
    `Status: ${status} · Source: ${user?.acquisitionSource ?? 'direct'}`,
    `Total users: ${new Intl.NumberFormat('en').format(total)}`,
  ].join('\n');
}

async function buildReturningText(info: StartEventInfo): Promise<string> {
  const [user, status] = await Promise.all([
    getUser(info.telegramUserId),
    classifyUser(info.telegramUserId),
  ]);
  return [
    `${subjectOf(info)} pressed /start`,
    `Status: ${status} · Source: ${user?.acquisitionSource ?? 'direct'}`,
  ].join('\n');
}

/** Once a minute in summary mode: report the batch, exit when the flood ebbs. */
async function flushSummary(api: Api): Promise<void> {
  const now = Date.now();
  pruneWindow(now);

  const newCount = pendingNew;
  const returningCount = pendingReturning;
  pendingNew = 0;
  pendingReturning = 0;
  const total = newCount + returningCount;

  if (total > 0) {
    const text = `${total} starts in the last minute — ${newCount} new, ${returningCount} returning`;
    const delivered = await sendToAdmins(api, text);
    await recordEvent({
      type: 'notify.start_summary',
      payload: { new: newCount, returning: returningCount, deliveredToAdmins: delivered },
    });
  }

  // Rate back below the threshold -> return to individual notifications.
  if (recentStarts.length < FLOOD_THRESHOLD) {
    summaryMode = false;
    if (summaryTimer) {
      clearInterval(summaryTimer);
      summaryTimer = null;
    }
    log.info('start notifications: flood over, back to individual messages', {
      lastMinute: recentStarts.length,
    });
  }
}
