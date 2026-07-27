/**
 * A global pacer shared by every worker in a broadcast pool.
 *
 * Two properties matter, and both are about the pool as a whole rather than any
 * individual worker:
 *
 *  1. Smooth admission, not bursts. Each caller reserves the next slot on a
 *     monotonically advancing timeline, so output is spaced evenly at
 *     1000/perSecond ms no matter how many workers are running. A token bucket
 *     would let N parked workers claim N permits the instant one frees up and
 *     fire N simultaneous requests — exactly the burst this exists to prevent.
 *     A consequence worth knowing: in-flight requests settle at
 *     perSecond × latency (≈4 at 25/sec and 150ms), so raising the worker count
 *     buys tolerance for latency spikes, not extra load.
 *
 *  2. Global backoff. When Telegram answers 429, `pauseFor` moves a shared
 *     deadline that EVERY worker observes — including ones already sleeping,
 *     which re-check it on wake and re-queue. A per-worker backoff would leave
 *     the other workers hammering an endpoint that has already rate-limited us,
 *     which is the one way a pool performs worse than a sequential loop.
 *
 * Single-threaded JS makes the read-modify-write of `nextSlot` atomic between
 * awaits, so no locking is required.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class RateLimiter {
  private readonly intervalMs: number;
  /** Timestamp at which the next admitted call may start. */
  private nextSlot = 0;
  /** Global backoff deadline; 0 when not backing off. */
  private pausedUntil = 0;

  constructor(perSecond: number, private readonly clock: Clock = systemClock) {
    this.intervalMs = 1000 / Math.max(1, perSecond);
  }

  /** Block until this caller's slot arrives and no global backoff is active. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      const start = Math.max(now, this.nextSlot, this.pausedUntil);
      // Reserve our slot before yielding, so concurrent callers queue behind us.
      this.nextSlot = start + this.intervalMs;
      const wait = start - now;
      if (wait > 0) await this.clock.sleep(wait);
      // A 429 may have landed while we slept. If the deadline moved past us,
      // re-reserve rather than sending into an active backoff.
      if (this.clock.now() >= this.pausedUntil) return;
    }
  }

  /**
   * Register a global backoff of `seconds`. Extends an existing pause but never
   * shortens one — two overlapping 429s must not cancel each other out.
   */
  pauseFor(seconds: number): void {
    const until = this.clock.now() + Math.max(0, seconds) * 1000;
    if (until > this.pausedUntil) this.pausedUntil = until;
    if (this.nextSlot < this.pausedUntil) this.nextSlot = this.pausedUntil;
  }

  /** Milliseconds remaining on the global backoff; 0 when running normally. */
  pausedForMs(): number {
    return Math.max(0, this.pausedUntil - this.clock.now());
  }
}

/**
 * Run `items` through `worker` with at most `concurrency` in flight. Workers
 * pull from a shared cursor, so a slow item delays only its own worker.
 *
 * `worker` must not throw: a rejection here would propagate out of a detached
 * broadcast and become the unhandled rejection that caused the Jul 27 outage.
 * The caller guards each item; this asserts the contract rather than trusting
 * it, so a bug cannot escalate into a process kill.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  onWorkerError?: (err: unknown, item: T, index: number) => void,
): Promise<void> {
  let cursor = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        try {
          await worker(items[i]!, i);
        } catch (err) {
          onWorkerError?.(err, items[i]!, i);
        }
      }
    }),
  );
}
