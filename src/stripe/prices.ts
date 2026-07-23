import type Stripe from 'stripe';
import { stripe } from './client.js';
import { log } from '../util/logger.js';

/**
 * Price amounts live in Stripe (config only holds price ids), but checkout copy
 * and /stats need real figures. Retrieved once per process and cached — prices
 * are immutable in Stripe, so the cache never goes stale.
 */

const cache = new Map<string, Stripe.Price>();

export async function getPrice(priceId: string): Promise<Stripe.Price | null> {
  const hit = cache.get(priceId);
  if (hit) return hit;
  try {
    const price = await stripe.prices.retrieve(priceId);
    cache.set(priceId, price);
    return price;
  } catch (err) {
    log.warn('could not retrieve stripe price', { priceId, error: err });
    return null;
  }
}

export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/** Human display for a price, e.g. "€49" — null when Stripe is unreachable. */
export async function priceDisplay(priceId: string): Promise<string | null> {
  const price = await getPrice(priceId);
  if (!price || price.unit_amount == null) return null;
  return formatAmount(price.unit_amount / 100, price.currency);
}
