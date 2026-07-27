import { impactedInstruments } from '../util/instruments.js';
import { type EconomicEvent, timeIsUnscheduled } from './schema.js';

/**
 * Message rendering.
 *
 * The editorial rule, enforced here and nowhere else: this module reports
 * numbers. It never interprets them. There is no bullish/bearish, no
 * USD-positive, no buy/sell, no "watch for a move higher". The deviation line
 * is arithmetic — a subtraction rendered in the reading's own unit — and the
 * desk draws the conclusion. Any future edit that adds a directional word is
 * a regression, not a feature. The 📈/📉 markers describe the arithmetic
 * relative to forecast, nothing about price.
 *
 * These post into a topic shared with live trade execution, so every message
 * is built to be recognised in a glance: a stage marker and a flag in fixed
 * leading positions, then the shortest line that still carries the facts.
 *
 * Emoji discipline: they appear ONLY as leading markers, in the positions
 * defined here. Never mid-sentence, and never in /news_status or any other
 * admin output — those stay plain text.
 */

/** Stage markers. Always the first character of the message's first line. */
const MARK_UPCOMING = '⏳';
const MARK_RELEASING = '🔴';
const MARK_RESULT = '✅';
const MARK_UNSCHEDULED = '📅';
const MARK_IMPACT = '⚡';
const MARK_ABOVE = '📈';
const MARK_BELOW = '📉';
const MARK_INLINE = '➖';

/**
 * Currency flags. An unmapped currency gets NO flag rather than a wrong one —
 * a misattributed country is worse than a missing decoration.
 */
const CURRENCY_FLAG: Record<string, string> = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  JPY: '🇯🇵',
  GBP: '🇬🇧',
};

/** "🇺🇸 USD" — or plain "CHF" when the currency has no flag. */
function currencyLabel(currency: string): string {
  const code = currency.trim().toUpperCase();
  const flag = CURRENCY_FLAG[code];
  return flag ? `${flag} ${esc(code)}` : esc(code);
}

/**
 * The three desks a release is read from, in reading order.
 *
 * IANA zone ids, never fixed offsets — the London/New York DST transitions do
 * not align with each other, so the gap between them is not constant and only
 * the tz database gets it right year-round.
 */
const ZONES = [
  { label: 'London', timeZone: 'Europe/London' },
  { label: 'New York', timeZone: 'America/New_York' },
  { label: 'Dubai', timeZone: 'Asia/Dubai' },
] as const;

/** Escape the five characters Telegram's HTML parse mode cares about. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HH:MM for an instant, read in the given zone. */
function timeIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** "Wed 29 Jul" for an instant, read in the given zone. */
function dateIn(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  // Assembled from parts rather than formatted directly, so no locale can slip
  // a comma into the middle of it.
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

/** 'YYYY-MM-DD' in the given zone — used only to test whether dates agree. */
function dateKeyIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The three desk clocks, always computed from the stored UTC instant — never
 * from a pre-formatted provider string.
 *
 * Two forms, because the zones span UTC-4 to UTC+4 and the calendar date
 * frequently splits across them:
 *
 *   same date  -> "London 06:49 · New York 01:49 · Dubai 09:49"
 *   split      -> "Wed 29 Jul 23:00 London · Wed 29 Jul 18:00 New York · Thu 30 Jul 02:00 Dubai"
 *
 * The compact form is only safe when all three agree; the moment one differs,
 * every entry carries its own date so no reader has to work out which day is
 * theirs.
 */
export function zoneTimes(at: Date): string {
  const rows = ZONES.map((z) => ({
    label: z.label,
    time: timeIn(at, z.timeZone),
    date: dateIn(at, z.timeZone),
    key: dateKeyIn(at, z.timeZone),
  }));

  const sameDate = new Set(rows.map((r) => r.key)).size === 1;
  return sameDate
    ? rows.map((r) => `${r.label} ${r.time}`).join(' · ')
    : rows.map((r) => `${r.date} ${r.time} ${r.label}`).join(' · ');
}

/** A numeric reading and the unit it was expressed in. */
interface Reading {
  value: number;
  /** '%', 'K', 'M', 'B', 'T', or '' for a bare number. */
  unit: string;
}

/**
 * Parse "180K", "3.2%", "-0.4", "1,250" into a comparable value.
 * Returns null for anything ambiguous — which suppresses the deviation line
 * rather than risking a wrong number.
 */
export function parseReading(raw: string | null): Reading | null {
  if (!raw) return null;
  const s = raw.replace(/,/g, '').trim();
  const m = /^([+-]?\d+(?:\.\d+)?)\s*(%|K|M|B|T)?$/i.exec(s);
  if (!m) return null;
  const value = Number(m[1]!);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (m[2] ?? '').toUpperCase() };
}

/**
 * Attach the provider's unit to a reading.
 *
 * Providers send the number and its unit separately, so a consensus of 1 with
 * unit "%" arrived in the topic as a bare "1" — meaningless on its own and
 * easy to misread by an order of magnitude.
 *
 * Applied before the deviation is computed, so the arithmetic sees percentages
 * as percentages and reports points rather than a bare difference.
 *
 * Skipped when the value already expresses the unit, either literally
 * ("1%" with unit "%") or through its own magnitude suffix — "216K" carrying
 * unit "Jobs" must not become "216K Jobs".
 */
export function withUnit(value: string | null, unit: string | null | undefined): string | null {
  if (!value) return value;
  const u = (unit ?? '').trim();
  if (!u) return value;
  if (value.toLowerCase().endsWith(u.toLowerCase())) return value;
  if (/[%KMBT]$/i.test(value)) return value;
  return u === '%' ? `${value}%` : `${value} ${u}`;
}

/** Trim float noise: 0.19999999999999996 -> "0.2". */
function trimNumber(n: number): string {
  return String(Number(n.toFixed(4)));
}

/** Render a magnitude in the reading's own unit; percentages become points. */
function formatDelta(magnitude: number, unit: string): string {
  if (unit === '%') return `${trimNumber(magnitude)}pp`;
  return `${trimNumber(magnitude)}${unit}`;
}

/**
 * The mechanical deviation line, or null when it cannot be stated factually.
 *
 * Suppressed when either side is missing, either side is non-numeric, or the
 * units disagree — in all three cases the honest output is nothing at all.
 */
export function deviationLine(actual: string | null, forecast: string | null): string | null {
  const a = parseReading(actual);
  const f = parseReading(forecast);
  if (!a || !f || a.unit !== f.unit) return null;

  const diff = a.value - f.value;
  if (diff === 0) return `${MARK_INLINE} In line with forecast`;
  const marker = diff > 0 ? MARK_ABOVE : MARK_BELOW;
  const direction = diff > 0 ? 'Above' : 'Below';
  return `${marker} ${direction} forecast by ${formatDelta(Math.abs(diff), a.unit)}`;
}

/** "🇺🇸 USD · Non-Farm Payrolls" — the identity line shared by release and result. */
function identity(event: Pick<EconomicEvent, 'currency' | 'title'>): string {
  return `${currencyLabel(event.currency)} · ${esc(event.title)}`;
}

/**
 * "Forecast 180K · Previous 145K" from the readings that exist, or null when
 * none do — so a value-less event drops the line rather than printing labels
 * with nothing after them.
 */
function valuesLine(pairs: Array<[string, string | null]>): string | null {
  const parts = pairs
    .filter(([, v]) => v !== null && v.trim() !== '')
    .map(([label, v]) => `${label} ${esc(v!)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * "⚡ Impact on: EUR/USD · Gold", or null when this currency moves nothing the
 * desk trades — in which case the line is omitted rather than padded.
 */
function impactLine(currency: string): string | null {
  const instruments = impactedInstruments(currency);
  if (instruments.length === 0) return null;
  return `${MARK_IMPACT} Impact on: ${instruments.map(esc).join(' · ')}`;
}

/**
 * T-5 notice. The order is fixed and deliberate:
 *
 *   1. currency and event name
 *   2. "Releases in 5 minutes."
 *   3. blank
 *   4. Previous, Forecast
 *   5. blank
 *   6. the three times
 *   7. blank
 *   8. the volatility line
 */
export function renderReminder(event: EconomicEvent): string {
  // A speech or press conference begins; it does not release.
  const kind = event.isSpeech ? 'speech' : 'news';
  const lines = [
    `${MARK_UPCOMING} ${currencyLabel(event.currency)} ${kind} in 5 minutes`,
    esc(event.title),
  ];

  // Speeches and statements carry no numbers — drop the line, not just its
  // contents, so no empty gap is left behind.
  const values = valuesLine([
    ['Forecast', withUnit(event.forecast, event.unit)],
    ['Previous', withUnit(event.previous, event.unit)],
  ]);
  if (values) lines.push('', values);

  lines.push('', zoneTimes(event.releaseAt));

  const impact = impactLine(event.currency);
  if (impact) lines.push('', impact);

  return lines.join('\n');
}

/**
 * Release post. Deliberately thin — this exact message is edited into the
 * result a moment later, so the topic carries two messages per event, not three.
 *
 * No times: the T-5 notice already gave them, and "Releasing now" is its own
 * timestamp.
 */
export function renderRelease(event: EconomicEvent): string {
  // One line: it lands mid-execution and only has to say "this is happening".
  return `${MARK_RELEASING} ${identity(event)} — ${event.isSpeech ? 'starting now' : 'releasing now'}`;
}

/**
 * Result. Normally an in-place edit of the release message.
 *
 * For an event whose time was only an estimate there is no release message to
 * edit — nothing was posted, precisely because the time could not be trusted.
 * That case is posted fresh and opens by saying so, so a number appearing
 * without warning is explained rather than merely unexplained.
 */
export function renderResult(event: EconomicEvent): string {
  const lines: string[] = [];
  if (timeIsUnscheduled(event)) lines.push(`${MARK_UNSCHEDULED} Time was not scheduled in advance`);

  lines.push(`${MARK_RESULT} ${identity(event)}`);

  // Units applied before the deviation, so percentages compare as percentages.
  const actual = withUnit(event.actual, event.unit);
  const forecast = withUnit(event.forecast, event.unit);

  const values = valuesLine([
    ['Actual', actual],
    ['Forecast', forecast],
    ['Previous', withUnit(event.previous, event.unit)],
    ['Revised', withUnit(event.revised, event.unit)],
  ]);
  if (values) lines.push(values);

  const deviation = deviationLine(actual, forecast);
  if (deviation) lines.push(deviation);

  return lines.join('\n');
}
