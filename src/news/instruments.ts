/**
 * Member-facing instrument naming.
 *
 * One map, used everywhere the desk's instruments appear in a message, so a
 * ticker never leaks into member-facing copy in raw form. Members read
 * "Gold", not "XAUUSD".
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
 * Instruments that reliably move on USD/EUR/JPY high-impact prints, in the
 * order they are read out.
 */
export const WATCHED_INSTRUMENTS = ['EURUSD', 'XAUUSD', 'EURJPY'] as const;

/**
 * Join with an Oxford-style "and" before the final item:
 * "EUR/USD, Gold, and EUR/JPY".
 */
export function oxfordList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** "EUR/USD, Gold, and EUR/JPY" — the watched set, named for members. */
export function watchedInstrumentsSentence(): string {
  return oxfordList(WATCHED_INSTRUMENTS.map(instrumentName));
}
