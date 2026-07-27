import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/**
 * Database-level tests for the delivery predicates.
 *
 * These exist because of a production incident that unit tests could not have
 * caught. The TypeScript predicates were correct; the SQL that mirrors them was
 * not. A raw sql`a or b` chunk was interpolated into an AND list without
 * parentheses, and because OR binds looser than AND the whole condition
 * collapsed to `(release_at > floor AND is_tentative) OR (...)` — every clause
 * after the OR, including the dedup guard, was bypassed. Two future-dated
 * events with no value posted to the live group.
 *
 * The lesson is that predicate composition has to be asserted against a real
 * planner, so that is what these do.
 *
 * Opt-in, and deliberately NOT keyed on DATABASE_URL: these TRUNCATE tables, so
 * pointing them at a live database by having production credentials already in
 * the environment must be impossible.
 *
 *   createdb rangefx_test
 *   NEWS_TEST_DATABASE_URL=postgres://localhost/rangefx_test npm test
 */

const TEST_DB = process.env.NEWS_TEST_DATABASE_URL?.trim();
const skip = TEST_DB ? undefined : 'set NEWS_TEST_DATABASE_URL (throwaway db) to run';

describe('pendingTentativeResults', { skip }, () => {
  let repo: typeof import('./repo.js');
  let dbmod: typeof import('../db/index.js');

  before(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    dbmod = await import('../db/index.js');
    const migrate = await import('../db/migrate.js');
    repo = await import('./repo.js');
    await migrate.runMigrations();
  });

  after(async () => {
    await dbmod.pool.end();
  });

  /** Insert one event and return how many the predicate selects. */
  async function selectedFor(opts: {
    releaseSql: string;
    actualSql: string;
    isTentative?: boolean;
    isAllDay?: boolean;
    isSpeech?: boolean;
    isReport?: boolean;
    withResultDelivery?: boolean;
  }): Promise<number> {
    const { pool } = dbmod;
    await pool.query('TRUNCATE economic_events, news_deliveries RESTART IDENTITY CASCADE');
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO economic_events
         (provider, provider_event_id, currency, title, impact, release_at, actual,
          is_tentative, is_all_day, is_speech, is_report)
       VALUES ('mock','e1','JPY','BoJ Policy','high', ${opts.releaseSql}, ${opts.actualSql}, $1,$2,$3,$4)
       RETURNING id`,
      [
        opts.isTentative ?? false,
        opts.isAllDay ?? false,
        opts.isSpeech ?? false,
        opts.isReport ?? false,
      ],
    );
    if (opts.withResultDelivery) {
      await pool.query(`INSERT INTO news_deliveries (event_id, kind) VALUES ($1,'result')`, [rows[0]!.id]);
    }
    return (await repo.pendingTentativeResults()).length;
  }

  const FUTURE = "now() + interval '4 days'";
  const RECENT = "now() - interval '1 hour'";
  const STALE = "now() - interval '3 days'";

  // The exact production case: BoJ dated four days out, no value.
  it('does not select a FUTURE tentative event with a NULL actual', async () => {
    assert.equal(await selectedFor({ releaseSql: FUTURE, actualSql: 'NULL', isTentative: true }), 0);
  });

  it('does not select a future tentative event even when it has a real actual', async () => {
    assert.equal(await selectedFor({ releaseSql: FUTURE, actualSql: "'0.75%'", isTentative: true }), 0);
  });

  it('does not select an empty-string actual, which renders as no value', async () => {
    assert.equal(await selectedFor({ releaseSql: RECENT, actualSql: "''", isTentative: true }), 0);
    assert.equal(await selectedFor({ releaseSql: RECENT, actualSql: "'   '", isTentative: true }), 0);
  });

  it('does not select a report or a speech, which never print', async () => {
    assert.equal(
      await selectedFor({ releaseSql: RECENT, actualSql: "'0.75%'", isTentative: true, isReport: true }),
      0,
    );
    assert.equal(
      await selectedFor({ releaseSql: RECENT, actualSql: "'0.75%'", isTentative: true, isSpeech: true }),
      0,
    );
  });

  it('does not select an event older than the 24h window', async () => {
    assert.equal(await selectedFor({ releaseSql: STALE, actualSql: "'0.75%'", isTentative: true }), 0);
  });

  it('does not select an ordinary scheduled event', async () => {
    assert.equal(await selectedFor({ releaseSql: RECENT, actualSql: "'0.75%'" }), 0);
  });

  // The dedup guard sat after the OR and was silently bypassed. Only the
  // unique index kept the incident to one message per event.
  it('honours the dedup guard when a result was already delivered', async () => {
    assert.equal(
      await selectedFor({
        releaseSql: RECENT,
        actualSql: "'0.75%'",
        isTentative: true,
        withResultDelivery: true,
      }),
      0,
    );
  });

  it('DOES select the one valid case: recently released, tentative, real value', async () => {
    assert.equal(await selectedFor({ releaseSql: RECENT, actualSql: "'0.75%'", isTentative: true }), 1);
    assert.equal(await selectedFor({ releaseSql: RECENT, actualSql: "'0.75%'", isAllDay: true }), 1);
  });
});
