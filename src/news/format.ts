import { DESK_TZ, LONDON_TZ } from './config.js';
import { type EconomicEvent } from './schema.js';

/**
 * Message rendering.
 *
 * The editorial rule, enforced here and nowhere else: this module reports
 * numbers. It never interprets them. There is no bullish/bearish, no
 * USD-positive, no buy/sell, no "watch for a move higher". The deviation line
 * is arithmetic — a subtraction rendered in the reading's own unit — and the
 * desk draws the conclusion. Any future edit that adds a directional word is
 * a regression, not a feature.
 */

/** Instruments that reliably move on USD/EUR/JPY high-impact prints. */
const WATCHED_INSTRUMENTS = 'EURUSD, XAUUSD, EURJPY';

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

/**
 * Both desk clocks, always computed from the stored UTC instant — never from a
 * pre-formatted provider string.
 */
export function bothTimes(at: Date): string {
  return `${timeIn(at, DESK_TZ)} Makassar · ${timeIn(at, LONDON_TZ)} London`;
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
  if (diff === 0) return 'Actual in line with forecast.';
  const direction = diff > 0 ? 'above' : 'below';
  return `Actual ${direction} forecast by ${formatDelta(Math.abs(diff), a.unit)}.`;
}

/** "USD · Non-Farm Payrolls", escaped and bolded. */
function heading(event: Pick<EconomicEvent, 'currency' | 'title'>): string {
  return `<b>${esc(event.currency)} · ${esc(event.title)}</b>`;
}

/** "Forecast: 180K" for each reading that exists. */
function readingLines(pairs: Array<[string, string | null]>): string[] {
  return pairs.filter(([, v]) => v !== null && v !== '').map(([label, v]) => `${label}: ${esc(v!)}`);
}

/** T-5 notice: what is coming, what is expected, when, and where it lands. */
export function renderReminder(event: EconomicEvent): string {
  const lines = [heading(event), 'Releases in 5 minutes.', ''];
  const readings = readingLines([
    ['Previous', event.previous],
    ['Forecast', event.forecast],
  ]);
  if (readings.length > 0) lines.push(...readings, '');
  lines.push(bothTimes(event.releaseAt), '');
  lines.push(`Elevated volatility expected on ${WATCHED_INSTRUMENTS}.`);
  return lines.join('\n');
}

/**
 * Release post. Deliberately thin — this exact message is edited into the
 * result a moment later, so the topic carries two messages per event, not three.
 */
export function renderRelease(event: EconomicEvent): string {
  return [heading(event), 'Releasing now.'].join('\n');
}

/** Result, rendered as an in-place edit of the release message. */
export function renderResult(event: EconomicEvent): string {
  const lines = [heading(event), ''];
  lines.push(
    ...readingLines([
      ['Actual', event.actual],
      ['Forecast', event.forecast],
      ['Previous', event.previous],
      ['Revised', event.revised],
    ]),
  );
  const deviation = deviationLine(event.actual, event.forecast);
  if (deviation) lines.push('', deviation);
  return lines.join('\n');
}
