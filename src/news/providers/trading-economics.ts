import { log } from '../../util/logger.js';
import { newsConfig, TE_GUEST_KEY } from '../config.js';
import { recordProviderRequest } from '../repo.js';
import { type Impact, type ProviderEndpoint } from '../schema.js';
import { type CalendarProvider, type RawEvent, type RawResult } from '../types.js';

/**
 * Trading Economics calendar adapter.
 *
 * Two things about this vendor drive the whole implementation:
 *
 *  1. Their `Date` field is documented as "Release date and time of the data in
 *     UTC" but is serialised WITHOUT an offset — "2016-12-02T13:30:00". Passing
 *     that to `new Date()` parses it as PROCESS-LOCAL time, which on a UTC
 *     Railway box is invisibly correct and on a developer's laptop is hours
 *     wrong. Every timestamp therefore goes through parseTradingEconomicsUtc(),
 *     which appends the UTC meaning explicitly. This is the single most
 *     important line in the file.
 *
 *  2. The historic `guest:guest` credential is GONE — the API answers HTTP 410
 *     "the guest account has been discontinued" to every calendar request. A
 *     deployment left on the default key will import zero events forever, so
 *     that case is logged loudly and distinctly rather than looking like an
 *     empty calendar.
 */

const BASE_URL = 'https://api.tradingeconomics.com/calendar';
const REQUEST_TIMEOUT_MS = 15_000;

/** Shape of a Trading Economics calendar row (only the fields we consume). */
interface TeRow {
  CalendarId?: string | number;
  Date?: string;
  Country?: string;
  Category?: string;
  Event?: string;
  Currency?: string;
  Importance?: number | string;
  Actual?: string | number | null;
  Forecast?: string | number | null;
  Previous?: string | number | null;
  Revised?: string | number | null;
  /** 0 = exact date/time known, 1 = the time is an estimate. */
  DateSpan?: number | string;
}

/**
 * Turn a Trading Economics timestamp into a true UTC instant.
 *
 * Accepts the offset-less form they actually send ("2026-07-28T12:30:00" —
 * documented as UTC, so we say so explicitly via Date.UTC), a date-only form,
 * and anything already carrying Z/±HH:MM (which we trust as-is). Returns null
 * on anything else rather than guessing.
 */
export function parseTradingEconomicsUtc(raw: string | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // Already explicit about its zone — trust it.
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;

  const d = new Date(
    Date.UTC(
      Number(m[1]!),
      Number(m[2]!) - 1,
      Number(m[3]!),
      Number(m[4] ?? '0'),
      Number(m[5] ?? '0'),
      Number(m[6] ?? '0'),
    ),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Importance 3 -> high, 2 -> medium, anything else -> low. */
export function mapImpact(importance: number | string | undefined): Impact {
  const n = typeof importance === 'string' ? Number.parseInt(importance, 10) : importance;
  if (n === 3) return 'high';
  if (n === 2) return 'medium';
  return 'low';
}

/**
 * TE's `Currency` field is frequently empty on calendar rows, so fall back to
 * the country. Only the countries we actually trade are mapped; anything else
 * yields '' and the row is dropped by the currency filter, which is correct.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  'united states': 'USD',
  'euro area': 'EUR',
  germany: 'EUR',
  france: 'EUR',
  italy: 'EUR',
  spain: 'EUR',
  netherlands: 'EUR',
  japan: 'JPY',
  'united kingdom': 'GBP',
  switzerland: 'CHF',
  canada: 'CAD',
  australia: 'AUD',
  'new zealand': 'NZD',
  china: 'CNY',
};

function resolveCurrency(row: TeRow): string {
  const direct = (row.Currency ?? '').trim().toUpperCase();
  if (direct) return direct;
  return COUNTRY_CURRENCY[(row.Country ?? '').trim().toLowerCase()] ?? '';
}

/** Normalise a reading to a trimmed string, or null when absent. */
function reading(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function toRawEvent(row: TeRow): RawEvent | null {
  const id = row.CalendarId === undefined || row.CalendarId === null ? '' : String(row.CalendarId).trim();
  const releaseAt = parseTradingEconomicsUtc(row.Date);
  const title = (row.Event ?? row.Category ?? '').trim();
  const currency = resolveCurrency(row);

  if (!id || !releaseAt || !title || !currency) return null;

  return {
    providerEventId: id,
    currency,
    title,
    impact: mapImpact(row.Importance),
    releaseAt,
    previous: reading(row.Previous),
    forecast: reading(row.Forecast),
    actual: reading(row.Actual),
    revised: reading(row.Revised),
  };
}

/** YYYY-MM-DD in UTC — the format TE's path-based range filter expects. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class TradingEconomicsProvider implements CalendarProvider {
  readonly name = 'trading_economics';

  private readonly apiKey: string;

  constructor(apiKey: string = newsConfig.teApiKey) {
    this.apiKey = apiKey;
    if (this.isGuest) {
      log.warn(
        'TE_API_KEY is the guest credential, which Trading Economics has discontinued (HTTP 410). ' +
          'Calendar imports will return nothing until a paid key is set — this is a subscription ' +
          'issue, not a bug in the importer.',
        { provider: this.name },
      );
    }
  }

  private get isGuest(): boolean {
    return this.apiKey.trim().toLowerCase() === TE_GUEST_KEY;
  }

  /**
   * One accounted HTTP call. Every request — success or failure — is logged to
   * news_provider_requests so /news_status can show quota burn before a plan
   * limit turns into mysteriously empty imports.
   */
  private async request(url: string, endpoint: ProviderEndpoint): Promise<unknown[] | null> {
    let ok = false;
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        if (res.status === 410 || res.status === 401 || res.status === 403) {
          // Entitlement, not transport. Say so unambiguously.
          log.error(
            'Trading Economics rejected the credential — set a paid TE_API_KEY. ' +
              'The guest account was discontinued and returns 410 to every calendar request.',
            { provider: this.name, endpoint, status: res.status, guest: this.isGuest, body },
          );
        } else {
          log.warn('trading economics request failed', { provider: this.name, endpoint, status: res.status, body });
        }
        return null;
      }

      const json: unknown = await res.json();
      if (!Array.isArray(json)) {
        log.warn('trading economics returned a non-array payload', {
          provider: this.name,
          endpoint,
          preview: JSON.stringify(json).slice(0, 300),
        });
        return null;
      }
      ok = true;
      return json;
    } catch (err) {
      log.warn('trading economics request errored', { provider: this.name, endpoint, error: err });
      return null;
    } finally {
      await recordProviderRequest(this.name, endpoint, ok);
    }
  }

  async fetchUpcoming(from: Date, to: Date): Promise<RawEvent[]> {
    const url = `${BASE_URL}/country/all/${isoDate(from)}/${isoDate(to)}?c=${encodeURIComponent(this.apiKey)}&f=json`;
    const rows = await this.request(url, 'calendar');
    if (rows === null) return [];

    if (rows.length === 0) {
      // A genuinely empty 48h high-impact calendar is possible but rare; far
      // more often this is a plan restriction. Flag it as a plan question so
      // nobody goes hunting for a parsing bug.
      log.warn(
        'Trading Economics returned 0 calendar rows. If this repeats, check the ' +
          'plan/entitlement on TE_API_KEY rather than debugging the importer.',
        { provider: this.name, from: from.toISOString(), to: to.toISOString(), guest: this.isGuest },
      );
      return [];
    }

    const mapped: RawEvent[] = [];
    let dropped = 0;
    let estimatedTime = 0;

    for (const raw of rows) {
      const row = raw as TeRow;
      const event = toRawEvent(row);
      if (!event) {
        dropped++;
        continue;
      }
      // DateSpan 1 means TE only estimated the release time. The event is real,
      // so we keep it, but a T-5 notice on an estimate is worth knowing about.
      if (String(row.DateSpan ?? '0') === '1') estimatedTime++;
      mapped.push(event);
    }

    log.info('trading economics calendar fetched', {
      provider: this.name,
      returned: rows.length,
      mapped: mapped.length,
      dropped,
      estimatedTime,
    });

    return mapped;
  }

  async fetchResult(providerEventId: string): Promise<RawResult | null> {
    const url = `${BASE_URL}/calendarid/${encodeURIComponent(providerEventId)}?c=${encodeURIComponent(this.apiKey)}&f=json`;
    const rows = await this.request(url, 'result');
    if (rows === null || rows.length === 0) return null;

    const row = rows[0] as TeRow;
    return {
      providerEventId,
      actual: reading(row.Actual),
      forecast: reading(row.Forecast),
      previous: reading(row.Previous),
      revised: reading(row.Revised),
    };
  }
}
