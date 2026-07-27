import { log } from '../../util/logger.js';
import { newsConfig } from '../config.js';
import { quotaAvailable } from '../quota.js';
import { recordProviderRequest } from '../repo.js';
import { type Impact, type ProviderEndpoint } from '../schema.js';
import { parseUtcInstant } from '../time.js';
import { type CalendarProvider, type RawEvent, type RawResult, type ResultQuery } from '../types.js';

/**
 * RapidAPI economic calendar adapter.
 *
 * Cost shape drives the design. This API bills per request past the plan
 * allowance with no platform-side ceiling, and its upstream is re-scraped only
 * every ~5 minutes. Two consequences are baked in here:
 *
 *   • fetchResults() is ONE request covering every pending event, matched back
 *     by eventId. Never one request per event — that is the difference between
 *     a handful of calls a day and a bill.
 *   • Every request passes the hard monthly cap in quota.ts before it is made.
 *
 * `dateUtc` is documented as ISO 8601 with a Z suffix ("2024-01-15T13:30:00.000Z").
 * That is taken from the vendor's published schema, NOT from a live response —
 * this adapter was written without a subscribed key. So the parser accepts both
 * forms and warns loudly the first time a timestamp arrives without an explicit
 * zone, which is what a broken contract would look like. It never silently
 * reinterprets one as the other.
 */

const BASE_URL = 'https://economic-calendar-api.p.rapidapi.com/calendar';
const RAPIDAPI_HOST = 'economic-calendar-api.p.rapidapi.com';
const REQUEST_TIMEOUT_MS = 15_000;
/** The API's documented ceiling. */
const MAX_LIMIT = 500;

/**
 * countryCode is deliberately NOT sent.
 *
 * The currency filter is applied locally from news_settings, and a wrong or
 * differently-spelled country code (is the euro area "EU", "EMU", or the member
 * states listed individually?) would silently drop events rather than fail
 * loudly. Silent under-delivery is the worst failure mode for an alerting
 * system, so the payload is bounded by volatility + date range instead and the
 * currency match happens where it can be verified.
 */
const SEND_COUNTRY_CODE = false;

interface RapidRow {
  /** Row-level UUID. Kept verbatim; not used as the key. */
  id?: string | number;
  /** Event UUID — may identify a recurring SERIES rather than one occurrence. */
  eventId?: string | number;
  name?: string;
  countryCode?: string;
  currencyCode?: string;
  dateUtc?: string;
  volatility?: string;
  actual?: string | number | null;
  consensus?: string | number | null;
  previous?: string | number | null;
  revised?: string | number | null;
  unit?: string;
  /** Ignored on purpose — we compute deviation ourselves, mechanically. */
  isBetterThanExpected?: boolean;
  // Classification flags. These drive behaviour, not display.
  /** Release time is an estimate — BoJ still carries a plausible 03:00. */
  isTentative?: boolean;
  isAllDay?: boolean;
  isSpeech?: boolean;
  isReport?: boolean;
  // Captured as informational only; never rendered.
  potency?: string | number | null;
  ratioDeviation?: string | number | null;
  periodDateUtc?: string | null;
  periodType?: string | null;
}

/**
 * Build the occurrence key: `eventId:YYYY-MM-DD` from the UTC date of dateUtc.
 *
 * It is not established whether RapidAPI's eventId is per-occurrence or
 * per-series. If it is per-series, using it bare would make every recurring
 * release — jobless claims, the PMIs — collide on the unique constraint, and
 * each week would silently overwrite the last. Composing with the release date
 * is correct under either interpretation.
 *
 * The DATE is used, not the full timestamp, so that a revision to the release
 * time updates the existing row rather than spawning a duplicate. The residual
 * edge is a revision that crosses UTC midnight, which would produce one extra
 * row — strictly better than losing a week of history.
 *
 * This is also why the result matcher must recompose the key rather than
 * comparing raw eventIds: the stored id and the response field are no longer
 * the same string.
 */
export function occurrenceKey(eventId: string, releaseAt: Date): string {
  return `${eventId}:${releaseAt.toISOString().slice(0, 10)}`;
}

/** volatility HIGH -> high, MEDIUM -> medium, everything else -> low. */
export function mapVolatility(volatility: string | undefined): Impact {
  switch ((volatility ?? '').trim().toUpperCase()) {
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    default:
      return 'low';
  }
}

function reading(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** YYYY-MM-DD in UTC, for startDate / endDate. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class RapidApiProvider implements CalendarProvider {
  readonly name = 'rapidapi';

  private readonly apiKey: string;

  /** Latched so a broken timestamp contract warns once, not once per row. */
  private warnedMissingZone = false;

  /** Set on every fetchUpcoming — see CalendarProvider.lastFetchTruncated. */
  lastFetchTruncated = false;

  constructor(apiKey: string = newsConfig.rapidApiKey) {
    this.apiKey = apiKey;
    if (!this.apiKey) {
      log.warn('RAPIDAPI_KEY is not set — the rapidapi provider will return nothing', { provider: this.name });
    }
  }

  /** One accounted, quota-gated HTTP call. */
  private async request(url: string, endpoint: ProviderEndpoint): Promise<RapidRow[] | null> {
    if (!this.apiKey) return null;
    // Hard billing gate. A blocked call is not a request and is not counted.
    if (!(await quotaAvailable(this.name))) return null;

    let ok = false;
    try {
      const res = await fetch(url, {
        headers: {
          'X-RapidAPI-Key': this.apiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        if (res.status === 401 || res.status === 403) {
          log.error(
            'RapidAPI rejected the credential — check RAPIDAPI_KEY and that the ' +
              'account is subscribed to the Economic Calendar API.',
            { provider: this.name, endpoint, status: res.status, body },
          );
        } else if (res.status === 429) {
          // Plan allowance, not our internal cap. Worth its own line.
          log.error('RapidAPI rate/quota limit hit (429) — plan allowance may be exhausted', {
            provider: this.name,
            endpoint,
            body,
          });
        } else {
          log.warn('rapidapi request failed', { provider: this.name, endpoint, status: res.status, body });
        }
        return null;
      }

      const json: unknown = await res.json();
      const rows = extractRows(json);
      if (rows === null) {
        log.warn('rapidapi returned an unrecognised payload shape', {
          provider: this.name,
          endpoint,
          preview: JSON.stringify(json).slice(0, 300),
        });
        return null;
      }
      ok = true;
      return rows;
    } catch (err) {
      log.warn('rapidapi request errored', { provider: this.name, endpoint, error: err });
      return null;
    } finally {
      await recordProviderRequest(this.name, endpoint, ok);
    }
  }

  private buildUrl(from: Date, to: Date, limit: number): string {
    const params = new URLSearchParams({
      startDate: isoDate(from),
      endDate: isoDate(to),
      volatility: 'HIGH',
      limit: String(Math.min(limit, MAX_LIMIT)),
    });
    if (SEND_COUNTRY_CODE) params.set('countryCode', 'US');
    return `${BASE_URL}?${params.toString()}`;
  }

  /** The stored occurrence key for a row, or null if it cannot be formed. */
  private keyFor(row: RapidRow): string | null {
    const seriesId = row.eventId === undefined || row.eventId === null ? '' : String(row.eventId).trim();
    const parsed = parseUtcInstant(row.dateUtc);
    if (!seriesId || !parsed) return null;
    return occurrenceKey(seriesId, parsed.at);
  }

  private toRawEvent(row: RapidRow): RawEvent | null {
    const seriesId = row.eventId === undefined || row.eventId === null ? '' : String(row.eventId).trim();
    const title = (row.name ?? '').trim();
    const currency = (row.currencyCode ?? '').trim().toUpperCase();
    const parsed = parseUtcInstant(row.dateUtc);

    if (!seriesId || !title || !currency || !parsed) return null;

    if (!parsed.explicitZone && !this.warnedMissingZone) {
      this.warnedMissingZone = true;
      // The documented contract is a Z suffix. If that stops being true the
      // times are still interpreted as UTC — but somebody needs to know the
      // vendor changed, rather than discovering it as offset alerts.
      log.error(
        'RapidAPI dateUtc arrived WITHOUT an explicit Z/offset, contrary to its ' +
          'documented schema. Treating it as UTC — verify against a live response ' +
          'before trusting release times.',
        { provider: this.name, sample: row.dateUtc },
      );
    }

    return {
      // Composite, not the bare eventId — see occurrenceKey().
      providerEventId: occurrenceKey(seriesId, parsed.at),
      currency,
      title,
      impact: mapVolatility(row.volatility),
      releaseAt: parsed.at,
      previous: reading(row.previous),
      forecast: reading(row.consensus),
      actual: reading(row.actual),
      revised: reading(row.revised),
      // Strict === true: an absent flag must mean "ordinary scheduled event",
      // never something truthy-but-unexpected changing how we post.
      isTentative: row.isTentative === true,
      isAllDay: row.isAllDay === true,
      isSpeech: row.isSpeech === true,
      isReport: row.isReport === true,
      // Informational only — captured for the record, never rendered.
      meta: {
        providerRowId: reading(row.id),
        providerSeriesId: seriesId,
        potency: reading(row.potency),
        ratioDeviation: reading(row.ratioDeviation),
        periodDateUtc: parseUtcInstant(row.periodDateUtc)?.at ?? null,
        periodType: reading(row.periodType),
      },
    };
  }

  async fetchUpcoming(from: Date, to: Date): Promise<RawEvent[]> {
    // Reset first: a stale `true` from a previous import must never leak into
    // this one's status.
    this.lastFetchTruncated = false;

    const rows = await this.request(this.buildUrl(from, to, MAX_LIMIT), 'calendar');
    if (rows === null) return [];

    // Exactly (or above) the requested limit means the provider stopped
    // counting, not that the calendar ended there.
    if (rows.length >= MAX_LIMIT) {
      this.lastFetchTruncated = true;
      log.error(
        `RapidAPI returned ${rows.length} rows at the requested limit of ${MAX_LIMIT} — the ` +
          'import window MAY BE TRUNCATED and events may have been dropped. Narrow the ' +
          'import horizon or raise the limit; do not treat this calendar as complete.',
        {
          provider: this.name,
          limit: MAX_LIMIT,
          returned: rows.length,
          from: isoDate(from),
          to: isoDate(to),
        },
      );
    }

    if (rows.length === 0) {
      log.warn('RapidAPI returned 0 calendar rows — check the plan/date range before debugging the importer', {
        provider: this.name,
        from: isoDate(from),
        to: isoDate(to),
      });
      return [];
    }

    const mapped: RawEvent[] = [];
    let dropped = 0;
    for (const row of rows) {
      const event = this.toRawEvent(row);
      if (event) mapped.push(event);
      else dropped++;
    }

    log.info('rapidapi calendar fetched', {
      provider: this.name,
      returned: rows.length,
      mapped: mapped.length,
      dropped,
      truncated: this.lastFetchTruncated,
    });

    return mapped;
  }

  /**
   * All pending results in ONE request.
   *
   * The endpoint is a range query, so we ask for the span the pending events
   * actually cover and match the response back by eventId. Cost is one request
   * per tick regardless of how many events are in flight.
   */
  async fetchResults(events: ResultQuery[]): Promise<RawResult[]> {
    if (events.length === 0) return [];

    const wanted = new Set(events.map((e) => e.providerEventId));
    // Events in the polling window are by definition near "now"; a one-day pad
    // each side covers a release that straddles a UTC date boundary.
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 3_600_000);
    const to = new Date(now.getTime() + 24 * 3_600_000);

    const rows = await this.request(this.buildUrl(from, to, MAX_LIMIT), 'result');
    if (rows === null) return [];

    const out: RawResult[] = [];
    for (const row of rows) {
      // Recompose the SAME composite key we stored. Comparing raw eventIds
      // here would match nothing, and would do so silently.
      const key = this.keyFor(row);
      if (!key || !wanted.has(key)) continue;
      const actual = reading(row.actual);
      // No print yet — omit rather than returning a null-actual row.
      if (actual === null) continue;
      out.push({
        providerEventId: key,
        actual,
        forecast: reading(row.consensus),
        previous: reading(row.previous),
        revised: reading(row.revised),
      });
    }

    log.info('rapidapi results fetched', {
      provider: this.name,
      requests: 1,
      pending: events.length,
      returned: rows.length,
      matched: out.length,
    });

    return out;
  }

  async fetchResult(providerEventId: string): Promise<RawResult | null> {
    const [only] = await this.fetchResults([{ providerEventId }]);
    return only ?? null;
  }
}

/** Accept a bare array or a common envelope shape. */
function extractRows(json: unknown): RapidRow[] | null {
  if (Array.isArray(json)) return json as RapidRow[];
  if (json && typeof json === 'object') {
    for (const key of ['data', 'result', 'results', 'events', 'items']) {
      const value = (json as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as RapidRow[];
    }
  }
  return null;
}
