import { log } from '../../util/logger.js';
import { type CalendarProvider, type RawEvent, type RawResult, type ResultQuery } from '../types.js';

/**
 * Synthetic calendar provider.
 *
 * Exists so the full pipeline — import, T-5 notice, release post, result edit —
 * can be exercised end to end without spending a single request against a
 * metered vendor API. /news_test drives it.
 *
 * State is in-memory and per-process by design: a test event is a live
 * rehearsal, not something that should survive a redeploy.
 */

/** How long after release the synthetic "print" becomes available. */
const RESULT_DELAY_MS = 15_000;

interface MockEvent {
  event: RawEvent;
  /** Revealed by fetchResult once the release time plus the delay has passed. */
  result: Omit<RawResult, 'providerEventId'>;
}

export class MockProvider implements CalendarProvider {
  readonly name = 'mock';

  private readonly events = new Map<string, MockEvent>();

  private counter = 0;

  /**
   * Create a synthetic high-impact event `minutesFromNow` out.
   *
   * The default numbers are chosen to exercise every branch of the renderer:
   * a forecast to deviate from, a previous, and a revised value.
   */
  schedule(minutesFromNow: number, overrides: Partial<RawEvent> = {}): RawEvent {
    this.counter += 1;
    const releaseAt = new Date(Date.now() + minutesFromNow * 60_000);
    // Second-precision id keeps repeated tests from colliding on the unique index.
    const providerEventId = overrides.providerEventId ?? `mock-${releaseAt.toISOString().slice(0, 19)}-${this.counter}`;

    const event: RawEvent = {
      providerEventId,
      currency: 'USD',
      title: 'Non-Farm Payrolls (test)',
      impact: 'high',
      releaseAt,
      previous: '145K',
      forecast: '180K',
      actual: null,
      revised: null,
      ...overrides,
    };

    this.events.set(providerEventId, {
      event,
      result: { actual: '210K', forecast: event.forecast, previous: event.previous, revised: '142K' },
    });

    log.info('mock event scheduled', {
      providerEventId,
      title: event.title,
      releaseAt: releaseAt.toISOString(),
      minutesFromNow,
    });

    return event;
  }

  async fetchUpcoming(from: Date, to: Date): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    for (const { event } of this.events.values()) {
      if (event.releaseAt >= from && event.releaseAt <= to) out.push(event);
    }
    return out;
  }

  /** Batch lookup. Events that have not "printed" yet are simply absent. */
  async fetchResults(events: ResultQuery[]): Promise<RawResult[]> {
    const out: RawResult[] = [];
    for (const { providerEventId } of events) {
      const entry = this.events.get(providerEventId);
      if (!entry) continue;
      // Nothing prints before the release — the poll must see a real "not yet".
      if (Date.now() < entry.event.releaseAt.getTime() + RESULT_DELAY_MS) continue;
      out.push({ providerEventId, ...entry.result });
    }
    return out;
  }

  async fetchResult(providerEventId: string): Promise<RawResult | null> {
    const [only] = await this.fetchResults([{ providerEventId }]);
    return only ?? null;
  }

  /** Drop synthetic events whose window has long passed. */
  prune(olderThanMinutes = 120): void {
    const floor = Date.now() - olderThanMinutes * 60_000;
    for (const [id, entry] of this.events) {
      if (entry.event.releaseAt.getTime() < floor) this.events.delete(id);
    }
  }
}

/**
 * Process-wide instance. /news_test schedules onto it and the result poll reads
 * back from it, so they must be the same object.
 */
export const mockProvider = new MockProvider();
