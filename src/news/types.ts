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

export interface CalendarProvider {
  name: string;
  fetchUpcoming(from: Date, to: Date): Promise<RawEvent[]>;
  fetchResult(providerEventId: string): Promise<RawResult | null>;
}
