import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateLimiter, runPool } from './rate-limiter.js';

/**
 * The global backoff is the part that has to be right. A per-worker backoff
 * would leave the rest of the pool hammering an endpoint that has already
 * rate-limited us, which is the one way parallelism performs worse than a
 * sequential loop. These use real timers with small intervals and assert lower
 * bounds only, so they cannot flake on a slow machine.
 */

const since = (t0: number) => Date.now() - t0;

describe('RateLimiter pacing', () => {
  it('spaces sequential acquires by the interval', async () => {
    const limiter = new RateLimiter(200); // 5ms apart
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await limiter.acquire();
    // 5 slots => 4 gaps. Allow one interval of scheduler slack.
    assert.ok(since(t0) >= 15, `expected >=15ms of pacing, got ${since(t0)}ms`);
  });

  it('paces the POOL as a whole, not each worker independently', async () => {
    const limiter = new RateLimiter(100); // 10ms apart
    const t0 = Date.now();
    // Ten concurrent callers must still be admitted one interval apart.
    await Promise.all(Array.from({ length: 10 }, () => limiter.acquire()));
    assert.ok(since(t0) >= 80, `ten concurrent acquires should take >=80ms, got ${since(t0)}ms`);
  });

  it('admits at most rate x latency concurrently — no burst on a free slot', async () => {
    const limiter = new RateLimiter(100); // 10ms apart
    const admitted: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        await limiter.acquire();
        admitted.push(since(t0));
      }),
    );
    admitted.sort((a, b) => a - b);
    // No two admissions may share the same millisecond band: a token bucket
    // would release all six at once here.
    assert.ok(admitted[5]! - admitted[0]! >= 40, `admissions bunched: ${JSON.stringify(admitted)}`);
  });
});

describe('RateLimiter global backoff', () => {
  it('pauseFor blocks EVERY worker, not just the one that saw the 429', async () => {
    const limiter = new RateLimiter(1000); // 1ms — pacing is negligible here
    await limiter.acquire();

    limiter.pauseFor(0.06); // 60ms global backoff
    const t0 = Date.now();
    const elapsed: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        await limiter.acquire();
        elapsed.push(since(t0));
      }),
    );

    for (const e of elapsed) {
      assert.ok(e >= 50, `a worker slipped through the global backoff after ${e}ms`);
    }
  });

  it('blocks a worker that was already sleeping when the backoff started', async () => {
    const limiter = new RateLimiter(50); // 20ms apart
    const t0 = Date.now();
    // Queue three; the 2nd and 3rd are asleep on their reserved slots.
    const waiters = Array.from({ length: 3 }, async () => {
      await limiter.acquire();
      return since(t0);
    });
    limiter.pauseFor(0.08); // 80ms, landing while they sleep
    const done = await Promise.all(waiters);
    // done[0] was admitted synchronously before the backoff existed — correctly
    // unaffected. The 2nd and 3rd were asleep on reserved slots when it landed,
    // and must observe the deadline on wake and re-queue behind it.
    for (const e of done.slice(1)) {
      assert.ok(e >= 70, `sleeping worker ignored the backoff, returned at ${e}ms`);
    }
  });

  it('extends an existing pause but never shortens it', () => {
    const limiter = new RateLimiter(100);
    limiter.pauseFor(10);
    const long = limiter.pausedForMs();
    limiter.pauseFor(0.01); // a shorter retry_after must not cancel the long one
    assert.ok(limiter.pausedForMs() >= long - 50, 'a shorter pause shortened the active backoff');
  });
});

describe('runPool', () => {
  it('processes every item exactly once', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];
    await runPool(items, 7, async (n) => {
      seen.push(n);
    });
    assert.equal(seen.length, 50);
    assert.deepEqual([...seen].sort((a, b) => a - b), items);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(Array.from({ length: 40 }, (_, i) => i), 5, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
    });
    assert.ok(peak <= 5, `peak concurrency ${peak} exceeded the limit of 5`);
  });

  it('a throwing worker cannot reject the pool', async () => {
    const errors: unknown[] = [];
    const done: number[] = [];
    await runPool(
      [1, 2, 3, 4],
      2,
      async (n) => {
        if (n % 2 === 0) throw new Error(`boom ${n}`);
        done.push(n);
      },
      (err) => errors.push(err),
    );
    // The odd items still completed; the even ones were reported, not thrown.
    assert.deepEqual(done.sort(), [1, 3]);
    assert.equal(errors.length, 2);
  });

  it('handles an empty item list', async () => {
    await runPool([], 10, async () => {
      throw new Error('must not run');
    });
  });
});
