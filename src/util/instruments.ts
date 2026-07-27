/**
 * Member-facing instrument naming.
 *
 * One map, used everywhere the desk's instruments appear in member-facing
 * text, so a ticker never leaks into copy in raw form. Members read "Gold",
 * not "XAUUSD".
 *
 * Lives in util/ rather than news/ because both the calendar messages and the
 * bot's plans/FAQ copy read from it. Keeping one source means the two can
 * never drift into naming the same instrument differently.
 */

/** Ticker -> the name members see. */
export const INSTRUMENT_DISPLAY: Record<string, string> = {
  XAUUSD: 'Gold',
  EURUSD: 'EUR/USD',
  EURJPY: 'EUR/JPY',
};

/**
 * Display name for a ticker. Unmapped symbols fall back to the ticker itself,
 * uppercased — visibly a ticker, which is the honest outcome for a symbol
 * nobody has named yet.
 */
export function instrumentName(symbol: string): string {
  const key = symbol.trim().toUpperCase();
  return INSTRUMENT_DISPLAY[key] ?? key;
}

/**
 * Which of the desk's instruments a release in a given currency actually
 * moves, in reading order.
 *
 * Replaces a single hardcoded list that claimed every print moved everything.
 * A currency absent from this map moves nothing the desk trades, and the
 * impact line is omitted rather than padded with instruments that are not
 * really implicated.
 */
export const CURRENCY_INSTRUMENTS: Record<string, readonly string[]> = {
  USD: ['EURUSD', 'XAUUSD'],
  EUR: ['EURUSD', 'EURJPY'],
  JPY: ['EURJPY'],
};

/** Display names of the instruments a currency moves; empty if none. */
export function impactedInstruments(currency: string): string[] {
  const tickers = CURRENCY_INSTRUMENTS[currency.trim().toUpperCase()] ?? [];
  return tickers.map(instrumentName);
}
