import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deviationLine, renderReminder, renderRelease, renderResult, withUnit, zoneTimes } from './format.js';
import { impactedInstruments, instrumentName } from '../util/instruments.js';
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
    unit: null,
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

describe('instrument naming and per-currency impact', () => {
  it('maps tickers to member-facing names', () => {
    assert.equal(instrumentName('XAUUSD'), 'Gold');
    assert.equal(instrumentName('EURUSD'), 'EUR/USD');
    assert.equal(instrumentName('EURJPY'), 'EUR/JPY');
    assert.equal(instrumentName('xauusd'), 'Gold');
  });

  it('falls back to the ticker when unmapped', () => {
    assert.equal(instrumentName('GBPUSD'), 'GBPUSD');
  });

  it('maps each currency to the instruments it actually moves', () => {
    assert.deepEqual(impactedInstruments('USD'), ['EUR/USD', 'Gold']);
    assert.deepEqual(impactedInstruments('EUR'), ['EUR/USD', 'EUR/JPY']);
    assert.deepEqual(impactedInstruments('JPY'), ['EUR/JPY']);
  });

  it('returns nothing for a currency the desk does not trade against', () => {
    assert.deepEqual(impactedInstruments('GBP'), []);
    assert.deepEqual(impactedInstruments('CHF'), []);
  });
});

describe('withUnit', () => {
  // The live bug: consensus 1 with unit "%" reached the topic as a bare "1".
  it('appends a percent unit the value does not carry', () => {
    assert.equal(withUnit('1', '%'), '1%');
    assert.equal(withUnit('-0.4', '%'), '-0.4%');
  });

  it('does not double up a unit the value already carries', () => {
    assert.equal(withUnit('1%', '%'), '1%');
    assert.equal(withUnit('216K', 'K'), '216K');
  });

  it('does not stack a word unit onto a magnitude suffix', () => {
    assert.equal(withUnit('216K', 'Jobs'), '216K');
  });

  it('leaves the value alone when there is no unit', () => {
    assert.equal(withUnit('180K', null), '180K');
    assert.equal(withUnit(null, '%'), null);
  });
});

describe('renderReminder', () => {
  it('renders the T-5 in the redesigned format', () => {
    assert.deepEqual(renderReminder(event('2026-07-29T05:49:00Z')).split('\n'), [
      '\u23f3 \ud83c\uddfa\ud83c\uddf8 USD news in 5 minutes',
      'Non-Farm Payrolls',
      '',
      'Forecast 180K \u00b7 Previous 145K',
      '',
      'London 06:49 \u00b7 New York 01:49 \u00b7 Dubai 09:49',
      '',
      '\u26a1 Impact on: EUR/USD \u00b7 Gold',
    ]);
  });

  it('says "speech" for a speech', () => {
    const out = renderReminder(event('2026-07-29T05:49:00Z', { isSpeech: true, previous: null, forecast: null }));
    assert.equal(out.split('\n')[0], '\u23f3 \ud83c\uddfa\ud83c\uddf8 USD speech in 5 minutes');
  });

  it('omits the values line entirely when both readings are null', () => {
    const out = renderReminder(
      event('2026-07-29T05:49:00Z', { title: 'FOMC Press Conference', isSpeech: true, previous: null, forecast: null }),
    );
    assert.deepEqual(out.split('\n'), [
      '\u23f3 \ud83c\uddfa\ud83c\uddf8 USD speech in 5 minutes',
      'FOMC Press Conference',
      '',
      'London 06:49 \u00b7 New York 01:49 \u00b7 Dubai 09:49',
      '',
      '\u26a1 Impact on: EUR/USD \u00b7 Gold',
    ]);
    assert.doesNotMatch(out, /Forecast|Previous/);
    assert.doesNotMatch(out, /\n\n\n/);
  });

  it('omits the impact line for a currency that moves nothing traded', () => {
    const out = renderReminder(event('2026-07-29T05:49:00Z', { currency: 'GBP', title: 'BoE Bank Rate' }));
    assert.doesNotMatch(out, /Impact on/);
    assert.equal(out.split('\n')[0], '\u23f3 \ud83c\uddec\ud83c\udde7 GBP news in 5 minutes');
  });

  it('uses no flag at all for an unmapped currency', () => {
    const out = renderReminder(event('2026-07-29T05:49:00Z', { currency: 'CHF', title: 'SNB Rate' }));
    assert.equal(out.split('\n')[0], '\u23f3 CHF news in 5 minutes');
  });

  it('keeps per-zone dates when the zones split', () => {
    const lines = renderReminder(event('2026-07-29T23:00:00Z')).split('\n');
    assert.equal(lines[5], 'Thu 30 Jul 00:00 London \u00b7 Wed 29 Jul 19:00 New York \u00b7 Thu 30 Jul 03:00 Dubai');
  });

  it('appends the unit to the values line', () => {
    const out = renderReminder(
      event('2026-07-29T05:49:00Z', { title: 'Inflation Rate YoY', forecast: '1', previous: '0.8', unit: '%' }),
    );
    assert.equal(out.split('\n')[3], 'Forecast 1% \u00b7 Previous 0.8%');
  });
});

describe('renderRelease', () => {
  it('is a single line', () => {
    assert.equal(
      renderRelease(event('2026-07-29T23:00:00Z')),
      '\ud83d\udd34 \ud83c\uddfa\ud83c\uddf8 USD \u00b7 Non-Farm Payrolls \u2014 releasing now',
    );
  });

  it('says "starting now" for a speech', () => {
    assert.equal(
      renderRelease(event('2026-07-29T23:00:00Z', { title: 'FOMC Press Conference', isSpeech: true })),
      '\ud83d\udd34 \ud83c\uddfa\ud83c\uddf8 USD \u00b7 FOMC Press Conference \u2014 starting now',
    );
  });
});

describe('renderResult', () => {
  it('renders the result in the redesigned format', () => {
    assert.deepEqual(renderResult(event('2026-07-29T12:30:00Z', { actual: '210K' })).split('\n'), [
      '\u2705 \ud83c\uddfa\ud83c\uddf8 USD \u00b7 Non-Farm Payrolls',
      'Actual 210K \u00b7 Forecast 180K \u00b7 Previous 145K',
      '\ud83d\udcc8 Above forecast by 30K',
    ]);
  });

  it('includes Revised only when present', () => {
    const withRev = renderResult(event('2026-07-29T12:30:00Z', { actual: '210K', revised: '142K' }));
    assert.match(withRev.split('\n')[1]!, /\u00b7 Revised 142K$/);
    assert.doesNotMatch(renderResult(event('2026-07-29T12:30:00Z', { actual: '210K' })), /Revised/);
  });

  it('marks below and in-line results', () => {
    assert.equal(
      renderResult(event('2026-07-29T12:30:00Z', { actual: '150K' })).split('\n')[2],
      '\ud83d\udcc9 Below forecast by 30K',
    );
    assert.equal(
      renderResult(event('2026-07-29T12:30:00Z', { actual: '180K' })).split('\n')[2],
      '\u2796 In line with forecast',
    );
  });

  it('omits the deviation when the values are not comparable', () => {
    const out = renderResult(event('2026-07-29T12:30:00Z', { actual: 'Beat' }));
    assert.equal(out.split('\n').length, 2);
    assert.doesNotMatch(out, /forecast by/);
  });

  it('applies the unit to values AND to the deviation', () => {
    // The live bug, end to end: bare 1 and 0.8 with unit "%".
    assert.deepEqual(
      renderResult(
        event('2026-07-29T12:30:00Z', { title: 'Inflation Rate YoY', actual: '1', forecast: '0.8', previous: '0.8', unit: '%' }),
      ).split('\n'),
      [
        '\u2705 \ud83c\uddfa\ud83c\uddf8 USD \u00b7 Inflation Rate YoY',
        'Actual 1% \u00b7 Forecast 0.8% \u00b7 Previous 0.8%',
        '\ud83d\udcc8 Above forecast by 0.2pp',
      ],
    );
  });

  it('never uses directional language', () => {
    const out = renderResult(event('2026-07-29T12:30:00Z', { actual: '210K', revised: '142K' }));
    assert.doesNotMatch(out, /bullish|bearish|buy|sell|positive|negative/i);
  });
});

describe('tentative results', () => {
  it('opens with the unscheduled marker', () => {
    assert.deepEqual(
      renderResult(
        event('2026-07-31T03:00:00Z', {
          currency: 'JPY',
          title: 'BoJ Interest Rate Decision',
          isTentative: true,
          actual: '0.75%',
          forecast: '0.5%',
          previous: '0.5%',
        }),
      ).split('\n'),
      [
        '\ud83d\udcc5 Time was not scheduled in advance',
        '\u2705 \ud83c\uddef\ud83c\uddf5 JPY \u00b7 BoJ Interest Rate Decision',
        'Actual 0.75% \u00b7 Forecast 0.5% \u00b7 Previous 0.5%',
        '\ud83d\udcc8 Above forecast by 0.25pp',
      ],
    );
  });

  it('adds no such line to an ordinary scheduled result', () => {
    assert.doesNotMatch(renderResult(event('2026-07-29T12:30:00Z', { actual: '210K' })), /not scheduled/);
  });
});

describe('emoji discipline', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{23E9}-\u{23FA}]/u;

  it('places emoji only at the start of a line, never mid-sentence', () => {
    const messages = [
      renderReminder(event('2026-07-29T05:49:00Z')),
      renderRelease(event('2026-07-29T12:30:00Z')),
      renderResult(event('2026-07-29T12:30:00Z', { actual: '210K' })),
      renderResult(event('2026-07-31T03:00:00Z', { isTentative: true, actual: '0.75%' })),
    ];
    for (const msg of messages) {
      for (const line of msg.split('\n')) {
        if (!EMOJI.test(line)) continue;
        // Every emoji must sit in the leading marker cluster: the run of
        // emoji and spaces that opens the line.
        const lead = /^(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{23E9}-\u{23FA}\u{FE0F}]|\s)+/u.exec(line)?.[0] ?? '';
        const rest = line.slice(lead.length);
        assert.ok(!EMOJI.test(rest), `emoji found mid-line: ${JSON.stringify(line)}`);
      }
    }
  });
});

describe('deviationLine', () => {
  it('renders percentage deviations in points', () => {
    assert.equal(deviationLine('2.4%', '2.2%'), '\u{1F4C8} Above forecast by 0.2pp');
  });

  it('states an exact match plainly', () => {
    assert.equal(deviationLine('180K', '180K'), '➖ In line with forecast');
  });

  it('suppresses itself when the two sides are not comparable', () => {
    assert.equal(deviationLine('210K', '2.2%'), null);
    assert.equal(deviationLine(null, '180K'), null);
    assert.equal(deviationLine('Beat', '180K'), null);
  });
});
