import { boolOf, intOf, optional } from '../config/env.js';

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

export const newsConfig = {
  enabled: boolOf('NEWS_ENABLED', false),
  /** Target chat. Unset = the whole module no-ops. */
  chatId: optional('NEWS_CHAT_ID', ''),
  /** Forum topic within that chat. Optional — omitted means the General topic. */
  topicId: optional('NEWS_TOPIC_ID', ''),
  provider: optional('NEWS_PROVIDER', 'mock'),
  teApiKey: optional('TE_API_KEY', TE_GUEST_KEY),
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
  /** Minutes after release during which an event is still polled for its actual. */
  pollWindowMinutes: intOf('NEWS_POLL_WINDOW_MINUTES', 5),
} as const;

/**
 * Clamped cadence values. A zero or negative interval from a fat-fingered env
 * would otherwise mean "run constantly" against a metered API.
 */
export const cadence = {
  importIntervalMinutes: Math.min(Math.max(newsConfig.importIntervalMinutes, 1), 1440),
  pollIntervalSeconds: Math.min(Math.max(newsConfig.pollIntervalSeconds, 5), 3600),
  pollWindowMinutes: Math.min(Math.max(newsConfig.pollWindowMinutes, 1), 120),
} as const;

function parseId(raw: string): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Numeric chat id, or null when unset/unparseable. */
export function newsChatId(): number | null {
  return parseId(newsConfig.chatId);
}

/** Numeric topic id, or undefined when unset (message goes to the main thread). */
export function newsTopicId(): number | undefined {
  return parseId(newsConfig.topicId) ?? undefined;
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
