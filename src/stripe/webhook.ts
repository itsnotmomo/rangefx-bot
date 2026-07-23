import type { Request, Response } from 'express';
import { type Api } from 'grammy';
import { stripe } from './client.js';
import { config } from '../config/index.js';
import { dispatchStripeEvent } from './handlers.js';
import { eventAlreadyProcessed, recordEvent } from '../services/events.js';
import { log } from '../util/logger.js';

/**
 * Express handler for POST /stripe/webhook. Must be mounted with a RAW body
 * parser so the Stripe signature can be verified against the exact bytes.
 *
 * Idempotency: we check `events.stripe_event_id` before doing any work and
 * record it after success. A duplicate delivery is acknowledged with 200 and
 * skipped. A processing error returns 500 so Stripe retries later.
 */
export function createStripeWebhookHandler(api: Api) {
  return async function stripeWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      res.status(400).send('Missing stripe-signature header');
      return;
    }

    let event;
    try {
      // req.body is a Buffer here (express.raw). Verify signature on raw bytes.
      event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);
    } catch (err) {
      log.warn('stripe signature verification failed', { error: err });
      res.status(400).send('Invalid signature');
      return;
    }

    // Fast idempotency check before doing any side-effectful work.
    if (await eventAlreadyProcessed(event.id)) {
      log.debug('duplicate stripe event ignored', { id: event.id, type: event.type });
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    try {
      await dispatchStripeEvent(api, event);
      // Mark processed only after successful handling.
      await recordEvent({ type: event.type, stripeEventId: event.id, payload: { id: event.id } });
      res.status(200).json({ received: true });
    } catch (err) {
      log.error('stripe event processing failed', { id: event.id, type: event.type, error: err });
      // 500 -> Stripe will retry; event not marked processed, so it can re-run.
      res.status(500).json({ received: false });
    }
  };
}
