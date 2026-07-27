import cron from 'node-cron';
import { type Api } from 'grammy';
import { log } from '../util/logger.js';
import { cadence, newsConfig, newsConfigured } from './config.js';
import { renderRelease, renderReminder, renderResult } from './format.js';
import { activeProvider, mockProvider, providerFor } from './providers/index.js';
import {
  applyResult,
  claimDelivery,
  dropDelivery,
  dueReleases,
  dueReminders,
  getSettings,
  markImported,
  passesFilter,
  pendingResults,
  pruneProviderRequests,
  releaseMessageId,
  setDeliveryMessageId,
  upsertEvents,
} from './repo.js';
import { sendNews, editNews, shouldSilence } from './telegram.js';

/**
 * The four scheduled jobs.
 *
 * Every one of them opens with the same guard: NEWS_ENABLED false or
 * NEWS_CHAT_ID unset means return immediately, before any database or network
 * access. Nothing posts anywhere by default.
 *
 * All sends follow one pattern — claim the delivery slot first, send second,
 * release the claim if the send failed. The unique index on
 * (event_id, kind) is therefore the thing preventing duplicates, not the cron
 * schedule's precision.
 */

const IMPORT_HORIZON_HOURS = 48;

/** Stops a slow run from stacking on top of itself on a per-minute schedule. */
const running = { import: false, reminder: false, release: false, result: false };

async function guarded(key: keyof typeof running, label: string, fn: () => Promise<void>): Promise<void> {
  if (running[key]) {
    log.warn('news job still running, skipping tick', { job: label });
    return;
  }
  running[key] = true;
  try {
    await fn();
  } catch (err) {
    log.error('news job crashed', { job: label, error: err });
  } finally {
    running[key] = false;
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Pull the next 48 hours and upsert on (provider, provider_event_id).
 *
 * Runs regardless of the paused flag: pausing means "stop talking", not "go
 * stale". When the desk resumes, the calendar is already current.
 */
export async function runImport(): Promise<void> {
  if (!newsConfigured()) return;

  const settings = await getSettings();
  const provider = activeProvider();
  const from = new Date();
  const to = new Date(from.getTime() + IMPORT_HORIZON_HOURS * 3_600_000);

  const fetched = await provider.fetchUpcoming(from, to);
  const kept = fetched.filter((e) => passesFilter(settings, e.currency, e.impact));
  const written = await upsertEvents(provider.name, kept);

  await markImported();
  // Cheap housekeeping on the slowest schedule we have.
  await pruneProviderRequests();
  mockProvider.prune();

  log.info('news import finished', {
    provider: provider.name,
    fetched: fetched.length,
    kept: kept.length,
    written,
    currencies: settings.currencies,
    minImpact: settings.minImpact,
  });
}

// ---------------------------------------------------------------------------
// T-5 reminder
// ---------------------------------------------------------------------------

export async function runReminders(api: Api): Promise<void> {
  if (!newsConfigured()) return;
  const settings = await getSettings();
  if (settings.paused) return;

  const due = await dueReminders();
  if (due.length === 0) return;

  const silent = shouldSilence(settings);
  for (const event of due) {
    // Claim before sending: a duplicate tick loses the race and stays quiet.
    if (!(await claimDelivery(event.id, 'pre_5m'))) continue;

    const messageId = await sendNews(api, renderReminder(event), silent);
    if (messageId === null) {
      // Free the slot so the next tick may retry while still inside the window.
      await dropDelivery(event.id, 'pre_5m');
      continue;
    }
    await setDeliveryMessageId(event.id, 'pre_5m', messageId);
    log.info('news reminder sent', { eventId: event.id, title: event.title, messageId });
  }
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

export async function runReleases(api: Api): Promise<void> {
  if (!newsConfigured()) return;
  const settings = await getSettings();
  if (settings.paused) return;

  const due = await dueReleases();
  if (due.length === 0) return;

  const silent = shouldSilence(settings);
  for (const event of due) {
    if (!(await claimDelivery(event.id, 'release'))) continue;

    const messageId = await sendNews(api, renderRelease(event), silent);
    if (messageId === null) {
      await dropDelivery(event.id, 'release');
      continue;
    }
    // This id is what the result poll edits in place a moment later.
    await setDeliveryMessageId(event.id, 'release', messageId);
    log.info('news release sent', { eventId: event.id, title: event.title, messageId });
  }
}

// ---------------------------------------------------------------------------
// Result poll
// ---------------------------------------------------------------------------

/**
 * Poll for prints, but only for events inside their post-release window that
 * were actually announced and have no actual yet. An empty set costs nothing —
 * which is what keeps this job from burning provider quota all day.
 */
export async function runResultPoll(api: Api): Promise<void> {
  if (!newsConfigured()) return;
  const settings = await getSettings();
  if (settings.paused) return;

  const pending = await pendingResults(new Date(), cadence.pollWindowMinutes);
  if (pending.length === 0) return;

  for (const event of pending) {
    // Resolve by the EVENT's provider, not the active one, so a mock test event
    // still resolves while the live importer runs against a real vendor.
    const provider = providerFor(event.provider);
    if (!provider) {
      log.warn('no provider registered for stored event', { eventId: event.id, provider: event.provider });
      continue;
    }

    const result = await provider.fetchResult(event.providerEventId);
    if (!result || result.actual === null) continue;

    if (!(await claimDelivery(event.id, 'result'))) continue;

    const merged = {
      ...event,
      actual: result.actual,
      forecast: result.forecast ?? event.forecast,
      previous: result.previous ?? event.previous,
      revised: result.revised ?? event.revised,
    };
    const text = renderResult(merged);

    // Edit the release message in place — two messages per event, not three.
    const messageId = await releaseMessageId(event.id);
    let delivered = false;

    if (messageId !== null) {
      delivered = await editNews(api, messageId, text);
      if (delivered) await setDeliveryMessageId(event.id, 'result', messageId);
    } else {
      // The release row exists but carries no id (its send failed mid-flight).
      // Posting fresh is better than losing the print entirely.
      const posted = await sendNews(api, text, shouldSilence(settings));
      delivered = posted !== null;
      if (posted !== null) await setDeliveryMessageId(event.id, 'result', posted);
    }

    if (!delivered) {
      // Leave `actual` unset too, so the next tick retries cleanly.
      await dropDelivery(event.id, 'result');
      continue;
    }

    await applyResult(event.id, result);
    log.info('news result delivered', {
      eventId: event.id,
      title: event.title,
      actual: result.actual,
      editedMessageId: messageId,
    });
  }
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Minutes -> 5-field cron expression. */
function minutesCron(minutes: number): string {
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = Math.round(minutes / 60);
  return hours >= 24 ? '0 0 * * *' : `0 */${hours} * * *`;
}

/** Seconds -> cron expression (6-field below a minute, 5-field at or above). */
function secondsCron(seconds: number): string {
  if (seconds < 60) return `*/${seconds} * * * * *`;
  return `*/${Math.max(1, Math.round(seconds / 60))} * * * *`;
}

function schedule(expr: string, label: string, fn: () => void): void {
  if (!cron.validate(expr)) {
    log.error('invalid news cron expression, job not scheduled', { job: label, expr });
    return;
  }
  cron.schedule(expr, fn, { timezone: 'UTC' });
}

/**
 * Register all four jobs. Safe to call unconditionally — when the module is not
 * configured each tick returns on its guard before touching anything, so a
 * dormant deployment does no work and posts nothing.
 */
export function scheduleNewsJobs(api: Api): void {
  const importExpr = minutesCron(cadence.importIntervalMinutes);
  const pollExpr = secondsCron(cadence.pollIntervalSeconds);

  schedule(importExpr, 'news.import', () => void guarded('import', 'news.import', () => runImport()));
  schedule('* * * * *', 'news.reminder', () => void guarded('reminder', 'news.reminder', () => runReminders(api)));
  schedule('* * * * *', 'news.release', () => void guarded('release', 'news.release', () => runReleases(api)));
  schedule(pollExpr, 'news.result', () => void guarded('result', 'news.result', () => runResultPoll(api)));

  log.info('news jobs scheduled', {
    configured: newsConfigured(),
    provider: newsConfig.provider,
    importCron: importExpr,
    pollCron: pollExpr,
    pollWindowMinutes: cadence.pollWindowMinutes,
  });

  if (!newsConfigured()) {
    log.info('news module dormant — NEWS_ENABLED is off or NEWS_CHAT_ID is unset; nothing will post');
    return;
  }

  // First import on boot so a fresh deploy is not blind until the next tick.
  void guarded('import', 'news.import', () => runImport());
}
