import { boolOf, intOf, optional } from '../config/env.js';
import { log } from '../util/logger.js';

/**
 * News-module configuration.
 *
 * Deliberately separate from src/config/index.ts: that module fails fast on
 * missing variables because the billing system cannot run half-configured.
 * This one must do the opposite — every value is optional and the module
 * simply stays dormant when unset. Adding these to the global config would
 * mean a news typo could stop payments booting.
 */

/** The desk sits in Makassar; every message leads with local time. */
export const DESK_TZ = 'Asia/Makassar';
export const LONDON_TZ = 'Europe/London';

/** Trading Economics' long-dead public credential. Kept as the documented default. */
export const TE_GUEST_KEY = 'guest:guest';

/** Default monthly request ceiling when NEWS_MONTHLY_REQUEST_CAP is not set. */
const DEFAULT_MONTHLY_CAP = 900;

/** Sentinel meaning "no ceiling". Infinity so comparisons need no special case. */
export const UNLIMITED_CAP = Number.POSITIVE_INFINITY;

/**
 * Parse the monthly request cap.
 *
 * The semantics are deliberately asymmetric, because this is a billing guard
 * and ambiguous input must fail toward NOT spending:
 *
 *   unset / empty      -> 900 (the default; the common, safe case)
 *   'unlimited' | '-1' -> no ceiling. Disabling the guard requires saying so
 *                         explicitly — it is never the result of a typo.
 *   0                  -> BLOCK every provider call. A literal zero budget
 *                         means zero requests, not "unlimited".
 *   any other negative -> BLOCK. Only the -1 sentinel disables.
 *   non-numeric        -> BLOCK, loudly. We do not know what was intended, and
 *                         guessing "unlimited" could cost money.
 */
export function parseMonthlyCap(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s === '') return DEFAULT_MONTHLY_CAP;
  if (s === 'unlimited' || s === '-1') return UNLIMITED_CAP;

  const n = Number.parseInt(s, 10);
  if (Number.isNaN(n)) {
    log.error(
      'NEWS_MONTHLY_REQUEST_CAP is not a number — blocking all provider calls. ' +
        'Set a positive integer, or "unlimited" (or -1) to disable the cap.',
      { value: raw },
    );
    return 0;
  }
  if (n < 0) {
    log.error(
      'NEWS_MONTHLY_REQUEST_CAP is negative — blocking all provider calls. ' +
        'Only -1 (or "unlimited") disables the cap.',
      { value: raw },
    );
    return 0;
  }
  return n;
}

export const newsConfig = {
  enabled: boolOf('NEWS_ENABLED', false),
  /** Target chat. Unset = the whole module no-ops. */
  chatId: optional('NEWS_CHAT_ID', ''),
  /** Forum topic within that chat. Optional — omitted means the General topic. */
  topicId: optional('NEWS_TOPIC_ID', ''),
  provider: optional('NEWS_PROVIDER', 'mock'),
  teApiKey: optional('TE_API_KEY', TE_GUEST_KEY),
  rapidApiKey: optional('RAPIDAPI_KEY', ''),
  /** 'HH:MM' in DESK_TZ. Both must be set for quiet hours to apply. */
  quietStart: optional('NEWS_QUIET_START', ''),
  quietEnd: optional('NEWS_QUIET_END', ''),

  // --- Cadence. Every knob here spends provider quota, so all three are
  // env-tunable and default conservatively. Raise them only against a plan
  // whose request allowance you have actually checked in /news_status.
  /** Minutes between calendar imports (default 6 hours). */
  importIntervalMinutes: intOf('NEWS_IMPORT_INTERVAL_MINUTES', 360),
  /** Seconds between result polls while any event is inside its window. */
  pollIntervalSeconds: intOf('NEWS_POLL_INTERVAL_SECONDS', 60),
  /**
   * Minutes after release during which an event is still polled for its actual.
   *
   * Default 15, not 5: the upstream calendar is scraped every ~5 minutes, so a
   * print can legitimately land several minutes after the release timestamp. A
   * 5-minute window closes before the number arrives and silently misses it.
   */
  pollWindowMinutes: intOf('NEWS_POLL_WINDOW_MINUTES', 15),

  /**
   * Hard ceiling on provider requests per UTC calendar month. Billing safety,
   * not telemetry: at the cap every provider call stops outright.
   * See parseMonthlyCap for why 0 blocks rather than disables.
   */
  monthlyRequestCap: parseMonthlyCap(optional('NEWS_MONTHLY_REQUEST_CAP', '')),
} as const;

/**
 * Clamped cadence values. A zero or negative interval from a fat-fingered env
 * would otherwise mean "run constantly" against a metered API.
 */
export const cadence = {
  importIntervalMinutes: Math.min(Math.max(newsConfig.importIntervalMinutes, 1), 1440),
  pollIntervalSeconds: Math.min(Math.max(newsConfig.pollIntervalSeconds, 5), 3600),
  pollWindowMinutes: Math.min(Math.max(newsConfig.pollWindowMinutes, 1), 120),
  // Passed through unclamped: 0 legitimately means "block everything" and
  // Infinity legitimately means "no ceiling". Clamping would destroy both.
  monthlyRequestCap: newsConfig.monthlyRequestCap,
} as const;

/**
 * Per-provider minimum polling interval, in seconds.
 *
 * RapidAPI's upstream is re-scraped every ~5 minutes, so polling faster than
 * that returns identical data and bills for the privilege. The floor is
 * enforced here rather than left to the operator, because the failure mode is
 * financial and silent.
 */
const PROVIDER_POLL_FLOOR_SECONDS: Record<string, number> = {
  rapidapi: 300,
};

/** The poll interval actually used, after applying the active provider's floor. */
export function effectivePollIntervalSeconds(providerName: string): number {
  const floor = PROVIDER_POLL_FLOOR_SECONDS[providerName] ?? 0;
  return Math.max(cadence.pollIntervalSeconds, floor);
}

function parseId(raw: string): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Numeric chat id, or null when unset/unparseable. */
export function newsChatId(): number | null {
  return parseId(newsConfig.chatId);
}

/**
 * Numeric topic id, or undefined for the General topic.
 *
 * Thread id 1 IS General in a Telegram forum, but passing message_thread_id: 1
 * explicitly is unreliable — the way to target General is to omit the field
 * altogether. Both "unset" and "1" therefore collapse to undefined here, and
 * the send layer omits the key entirely rather than sending an undefined.
 */
export function newsTopicId(): number | undefined {
  const id = parseId(newsConfig.topicId);
  if (id === null || id === 1) return undefined;
  return id;
}

/**
 * Admin ids for out-of-band alerts (currently the quota cap notice).
 *
 * Read straight from ADMIN_USER_IDS rather than importing config/index.ts:
 * same source of truth, but without dragging the billing system's fail-fast
 * validation into a module that must stay optional.
 */
export function newsAdminIds(): number[] {
  return optional('ADMIN_USER_IDS', '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * The master safety gate. Every job's first line.
 *
 * NEWS_ENABLED false or NEWS_CHAT_ID unset means nothing posts anywhere —
 * silently, with no warning spam on a per-minute cron.
 */
export function newsConfigured(): boolean {
  return newsConfig.enabled && newsChatId() !== null;
}

/** Minutes since midnight for `at`, as read in `timeZone`. */
function minutesInZone(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** Parse 'HH:MM' into minutes since midnight, or null if malformed. */
function parseHhMm(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]!);
  const min = Number(m[2]!);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Whether `at` falls inside quiet hours, evaluated in DESK_TZ.
 *
 * Windows wrap midnight (22:00 → 07:00 is the normal case). Quiet hours never
 * suppress a message — they only send it with disable_notification, because a
 * release the desk slept through still has to be in the topic afterwards.
 */
export function isQuietHour(start: string, end: string, at: Date = new Date()): boolean {
  const s = parseHhMm(start);
  const e = parseHhMm(end);
  if (s === null || e === null || s === e) return false;
  const now = minutesInZone(at, DESK_TZ);
  return s < e ? now >= s && now < e : now >= s || now < e;
}
