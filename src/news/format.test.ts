import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deviationLine, renderReminder, renderRelease, renderResult, zoneTimes } from './format.js';
import { instrumentName, oxfordList, watchedInstrumentsSentence } from '../util/instruments.js';
import { announcesSchedule, expectsNoActual, timeIsUnscheduled, type EconomicEvent } from './schema.js';

/**
 * Rendering tests. Run with `npm test`.
 *
 * These deliberately assert on exact strings: the message format IS the
 * product here, and "looks about right" is how a wrong clock reaches members.
 */

function event(iso: string, over: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 1,
    provider: 'rapidapi',
    providerEventId: 'series:2026-07-29',
    currency: 'USD',
    title: 'Non-Farm Payrolls',
    impact: 'high',
    releaseAt: new Date(iso),
    previous: '145K',
    forecast: '180K',
    actual: null,
    revised: null,
    actualReceivedAt: null,
    isTentative: false,
    isAllDay: false,
    isSpeech: false,
    isReport: false,
    providerRowId: null,
    providerSeriesId: null,
    potency: null,
    ratioDeviation: null,
    periodDateUtc: null,
    periodType: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('zoneTimes', () => {
  it('uses the compact form when all three zones share a date', () => {
    assert.equal(
      zoneTimes(new Date('2026-07-29T05:49:00Z')),
      'London 06:49 · New York 01:49 · Dubai 09:49',
    );
  });

  // The two cases the spec calls out by name. Both straddle a date boundary:
  // New York is a day behind while London and Dubai have already rolled over.
  it('splits dates at 02:00 UTC', () => {
    assert.equal(
      zoneTimes(new Date('2026-07-30T02:00:00Z')),
      'Thu 30 Jul 03:00 London · Wed 29 Jul 22:00 New York · Thu 30 Jul 06:00 Dubai',
    );
  });

  it('splits dates at 23:00 UTC', () => {
    assert.equal(
      zoneTimes(new Date('2026-07-29T23:00:00Z')),
      'Thu 30 Jul 00:00 London · Wed 29 Jul 19:00 New York · Thu 30 Jul 03:00 Dubai',
    );
  });

  it('splits when only Dubai has rolled over', () => {
    assert.equal(
      zoneTimes(new Date('2026-07-29T22:00:00Z')),
      'Wed 29 Jul 23:00 London · Wed 29 Jul 18:00 New York · Thu 30 Jul 02:00 Dubai',
    );
  });

  it('applies DST per zone rather than a fixed offset', () => {
    // BST: London is UTC+1, New York UTC-4.
    assert.equal(zoneTimes(new Date('2026-07-15T12:30:00Z')), 'London 13:30 · New York 08:30 · Dubai 16:30');
    // GMT/EST: London is UTC+0, New York UTC-5.
    assert.equal(zoneTimes(new Date('2026-01-15T12:30:00Z')), 'London 12:30 · New York 07:30 · Dubai 16:30');
    // The gap between London and New York is normally 5 hours, but between the
    // US and UK transitions it is 4 — only a real tz database gets this right.
    assert.equal(zoneTimes(new Date('2026-03-14T12:30:00Z')), 'London 12:30 · New York 08:30 · Dubai 16:30');
    // Dubai never observes DST.
    assert.ok(zoneTimes(new Date('2026-07-15T12:30:00Z')).endsWith('Dubai 16:30'));
    assert.ok(zoneTimes(new Date('2026-01-15T12:30:00Z')).endsWith('Dubai 16:30'));
  });

  it('never emits a timezone abbreviation or UTC offset', () => {
    for (const iso of ['2026-07-29T23:00:00Z', '2026-01-15T12:30:00Z', '2026-07-29T05:49:00Z']) {
      const out = zoneTimes(new Date(iso));
      assert.doesNotMatch(out, /\b(GMT|BST|UTC|EST|EDT|GST)\b/, out);
      assert.doesNotMatch(out, /[+-]\d{2}:?\d{2}/, out);
    }
  });
});

describe('instrument naming', () => {
  it('maps tickers to member-facing names', () => {
    assert.equal(instrumentName('XAUUSD'), 'Gold');
    assert.equal(instrumentName('EURUSD'), 'EUR/USD');
    assert.equal(instrumentName('EURJPY'), 'EUR/JPY');
    assert.equal(instrumentName('xauusd'), 'Gold');
  });

  it('falls back to the ticker when unmapped', () => {
    assert.equal(instrumentName('GBPUSD'), 'GBPUSD');
  });

  it('joins with an Oxford-style "and"', () => {
    assert.equal(oxfordList(['Gold']), 'Gold');
    assert.equal(oxfordList(['EUR/USD', 'Gold']), 'EUR/USD and Gold');
    assert.equal(watchedInstrumentsSentence(), 'EUR/USD, Gold, and EUR/JPY');
  });
});

describe('renderReminder', () => {
  it('emits the T-5 blocks in the specified order', () => {
    assert.deepEqual(renderReminder(event('2026-07-29T05:49:00Z')).split('\n'), [
      '<b>USD · Non-Farm Payrolls</b>',
      'Releases in 5 minutes.',
      '',
      'Previous: 145K',
      'Forecast: 180K',
      '',
      'London 06:49 · New York 01:49 · Dubai 09:49',
      '',
      'Elevated volatility expected on EUR/USD, Gold, and EUR/JPY.',
    ]);
  });

  it('carries per-zone dates when they split', () => {
    const lines = renderReminder(event('2026-07-29T23:00:00Z')).split('\n');
    assert.equal(lines[6], 'Thu 30 Jul 00:00 London · Wed 29 Jul 19:00 New York · Thu 30 Jul 03:00 Dubai');
  });
});

describe('renderRelease', () => {
  it('states only the release — the T-5 notice already carried the times', () => {
    assert.deepEqual(renderRelease(event('2026-07-29T23:00:00Z')).split('\n'), [
      '<b>USD · Non-Farm Payrolls</b>',
      'Releasing now.',
    ]);
  });
});

describe('renderResult', () => {
  it('reports numbers with a mechanical deviation and no direction', () => {
    const out = renderResult(event('2026-07-29T23:00:00Z', { actual: '210K', revised: '142K' }));
    assert.deepEqual(out.split('\n'), [
      '<b>USD · Non-Farm Payrolls</b>',
      '',
      'Actual: 210K',
      'Forecast: 180K',
      'Previous: 145K',
      'Revised: 142K',
      '',
      'Actual above forecast by 30K.',
    ]);
    assert.doesNotMatch(out, /bullish|bearish|buy|sell|positive|negative/i);
  });
});

describe('event classification', () => {
  // The repo's SQL filters mirror these predicates; the DB behaviour is
  // verified separately against Postgres.
  it('treats a tentative or all-day event as unscheduled, so it gets no timed posts', () => {
    const boj = event('2026-07-31T03:00:00Z', { isTentative: true });
    assert.equal(timeIsUnscheduled(boj), true);
    assert.equal(announcesSchedule(boj), false, 'a tentative event must produce no T-5 and no release');

    const allDay = event('2026-07-31T00:00:00Z', { isAllDay: true });
    assert.equal(announcesSchedule(allDay), false);
  });

  it('leaves an ordinary numeric event scheduled', () => {
    const nfp = event('2026-07-31T12:30:00Z');
    assert.equal(timeIsUnscheduled(nfp), false);
    assert.equal(announcesSchedule(nfp), true);
    assert.equal(expectsNoActual(nfp), false, 'a numeric print must still be polled for a result');
  });

  it('knows a speech or report will never print a number', () => {
    assert.equal(expectsNoActual(event('2026-07-31T18:00:00Z', { isSpeech: true })), true);
    assert.equal(expectsNoActual(event('2026-07-31T18:00:00Z', { isReport: true })), true);
  });
});

describe('speeches and value-less events', () => {
  const speech = (): EconomicEvent =>
    event('2026-07-29T05:49:00Z', {
      currency: 'USD',
      title: 'FOMC Press Conference',
      isSpeech: true,
      previous: null,
      forecast: null,
    });

  it('renders a value-less speech with no Previous/Forecast block and no empty lines', () => {
    const out = renderReminder(speech());
    assert.deepEqual(out.split('\n'), [
      '<b>USD · FOMC Press Conference</b>',
      'Begins in 5 minutes.',
      '',
      'London 06:49 · New York 01:49 · Dubai 09:49',
      '',
      'Elevated volatility expected on EUR/USD, Gold, and EUR/JPY.',
    ]);
    assert.doesNotMatch(out, /Previous|Forecast/);
    assert.doesNotMatch(out, /\n\n\n/, 'no blank-line gap left where the readings block was');
  });

  it('says "Begins"/"Starting" for a speech rather than "Releases"/"Releasing"', () => {
    assert.match(renderReminder(speech()), /^.*\nBegins in 5 minutes\./);
    assert.equal(renderRelease(speech()).split('\n')[1], 'Starting now.');
  });

  it('keeps "Releases"/"Releasing" for a written report', () => {
    const report = event('2026-07-29T05:49:00Z', { isReport: true, previous: null, forecast: null });
    assert.equal(renderReminder(report).split('\n')[1], 'Releases in 5 minutes.');
    assert.equal(renderRelease(report).split('\n')[1], 'Releasing now.');
  });
});

describe('tentative results', () => {
  it('opens by stating the time was not scheduled', () => {
    const boj = event('2026-07-31T03:00:00Z', {
      currency: 'JPY',
      title: 'BoJ Interest Rate Decision',
      isTentative: true,
      actual: '0.75%',
      forecast: '0.5%',
      previous: '0.5%',
    });
    assert.deepEqual(renderResult(boj).split('\n'), [
      'Release time was not scheduled in advance.',
      '',
      '<b>JPY · BoJ Interest Rate Decision</b>',
      '',
      'Actual: 0.75%',
      'Forecast: 0.5%',
      'Previous: 0.5%',
      '',
      'Actual above forecast by 0.25pp.',
    ]);
  });

  it('adds no such line to an ordinary scheduled result', () => {
    const out = renderResult(event('2026-07-29T12:30:00Z', { actual: '210K' }));
    assert.doesNotMatch(out, /not scheduled in advance/);
    assert.equal(out.split('\n')[0], '<b>USD · Non-Farm Payrolls</b>');
  });
});

describe('an ordinary numeric event is unchanged', () => {
  it('renders the T-5 exactly as before the classification work', () => {
    assert.deepEqual(renderReminder(event('2026-07-29T05:49:00Z')).split('\n'), [
      '<b>USD · Non-Farm Payrolls</b>',
      'Releases in 5 minutes.',
      '',
      'Previous: 145K',
      'Forecast: 180K',
      '',
      'London 06:49 · New York 01:49 · Dubai 09:49',
      '',
      'Elevated volatility expected on EUR/USD, Gold, and EUR/JPY.',
    ]);
  });

  it('renders the release and result exactly as before', () => {
    assert.deepEqual(renderRelease(event('2026-07-29T12:30:00Z')).split('\n'), [
      '<b>USD · Non-Farm Payrolls</b>',
      'Releasing now.',
    ]);
    assert.deepEqual(renderResult(event('2026-07-29T12:30:00Z', { actual: '210K', revised: '142K' })).split('\n'), [
      '<b>USD · Non-Farm Payrolls</b>',
      '',
      'Actual: 210K',
      'Forecast: 180K',
      'Previous: 145K',
      'Revised: 142K',
      '',
      'Actual above forecast by 30K.',
    ]);
  });
});

describe('deviationLine', () => {
  it('renders percentage deviations in points', () => {
    assert.equal(deviationLine('2.4%', '2.2%'), 'Actual above forecast by 0.2pp.');
  });

  it('states an exact match plainly', () => {
    assert.equal(deviationLine('180K', '180K'), 'Actual in line with forecast.');
  });

  it('suppresses itself when the two sides are not comparable', () => {
    assert.equal(deviationLine('210K', '2.2%'), null);
    assert.equal(deviationLine(null, '180K'), null);
    assert.equal(deviationLine('Beat', '180K'), null);
  });
});
