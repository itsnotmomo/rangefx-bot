import { type Impact } from './schema.js';

/**
 * The provider contract. Anything that can answer "what is coming up" and
 * "what did this print" can be plugged in — Trading Economics today, a
 * different vendor or a scraper tomorrow, without any job knowing.
 */

/** A calendar entry as the adapter has normalised it, ready to persist. */
export interface RawEvent {
  /** The provider's own identifier. Unique within that provider. */
  providerEventId: string;
  /** ISO 4217 code: USD, EUR, JPY. */
  currency: string;
  title: string;
  impact: Impact;
  /**
   * A true UTC instant. Adapters MUST normalise here — several vendors emit
   * offset-less strings that JS would otherwise parse as process-local time.
   */
  releaseAt: Date;
  previous: string | null;
  forecast: string | null;
  /** Usually null at import; populated once the number prints. */
  actual: string | null;
  revised: string | null;
}

/** The outcome of a single event, fetched after its release time. */
export interface RawResult {
  providerEventId: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  revised: string | null;
}

/** Minimal shape the batch poller passes down — just the key to match on. */
export interface ResultQuery {
  providerEventId: string;
}

export interface CalendarProvider {
  name: string;
  fetchUpcoming(from: Date, to: Date): Promise<RawEvent[]>;

  /**
   * Fetch results for MANY events at once. This is what the result poller uses,
   * exclusively — one call per tick covering every pending event, matched back
   * by providerEventId.
   *
   * Adapters over a range-query API (RapidAPI) must satisfy this with a single
   * HTTP request; the whole point is that N pending events cost one request,
   * not N. Adapters over a per-id API may loop internally.
   *
   * The returned array may be shorter than the input — events that have not
   * printed yet are simply absent, not null entries.
   */
  fetchResults(events: ResultQuery[]): Promise<RawResult[]>;

  /**
   * Single-event convenience, kept for ad-hoc lookups. NOT used by the poller.
   * Where the batch call is the primitive, this delegates to it.
   */
  fetchResult(providerEventId: string): Promise<RawResult | null>;
}
