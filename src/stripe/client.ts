import Stripe from 'stripe';
import { config } from '../config/index.js';

/** Shared Stripe SDK instance. Pinned API version for predictable webhook shapes. */
export const stripe = new Stripe(config.stripeSecretKey, {
  apiVersion: '2025-02-24.acacia',
  appInfo: { name: 'range-compound-bot' },
});
