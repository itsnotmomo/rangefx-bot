import { log } from '../../util/logger.js';
import { newsConfig } from '../config.js';
import { type CalendarProvider } from '../types.js';
import { mockProvider } from './mock.js';
import { TradingEconomicsProvider } from './trading-economics.js';

/**
 * Provider registry.
 *
 * Two lookups exist for a reason. `activeProvider()` answers "who imports?" and
 * follows NEWS_PROVIDER. `providerFor(name)` answers "who owns this stored
 * row?" and follows the event's own provider column — which is how a mock test
 * event still resolves its result while the live importer runs against Trading
 * Economics.
 */

const registry = new Map<string, CalendarProvider>();

function build(name: string): CalendarProvider | null {
  switch (name) {
    case 'mock':
      return mockProvider;
    case 'trading_economics':
    case 'tradingeconomics':
    case 'te':
      return new TradingEconomicsProvider();
    default:
      return null;
  }
}

/** Resolve a provider by name, instantiating once and caching. */
export function providerFor(name: string): CalendarProvider | null {
  const key = name.trim().toLowerCase();
  const cached = registry.get(key);
  if (cached) return cached;
  const built = build(key);
  if (!built) return null;
  registry.set(key, built);
  // Alias forms resolve to the same instance under its canonical name too.
  registry.set(built.name, built);
  return built;
}

/** The provider the import job uses, per NEWS_PROVIDER. Falls back to mock. */
export function activeProvider(): CalendarProvider {
  const chosen = providerFor(newsConfig.provider);
  if (chosen) return chosen;
  log.warn('unknown NEWS_PROVIDER, falling back to mock', { value: newsConfig.provider });
  return mockProvider;
}

export { mockProvider } from './mock.js';
export { TradingEconomicsProvider } from './trading-economics.js';
