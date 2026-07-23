import { stripe } from './client.js';
import { config, PLANS, type PlanKey } from '../config/index.js';
import { botDeepLink } from '../bot/runtime.js';
import { type User } from '../db/schema.js';

/**
 * Create a Stripe Checkout Session for a subscription plan. The Telegram user id
 * is stamped in three places so every downstream webhook can resolve the buyer:
 *   - client_reference_id (on the session)
 *   - metadata.telegram_user_id (on the session)
 *   - subscription_data.metadata.telegram_user_id (propagates onto the
 *     Subscription object, so subscription.* events carry it too)
 */
export async function createCheckoutSession(
  telegramUserId: bigint,
  planKey: PlanKey,
  user?: User,
): Promise<string> {
  const plan = PLANS[planKey];
  const uid = telegramUserId.toString();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: plan.priceId, quantity: 1 }],
    client_reference_id: uid,
    metadata: { telegram_user_id: uid, plan: plan.key },
    subscription_data: {
      metadata: { telegram_user_id: uid, plan: plan.key },
    },
    // Reuse an existing customer when we know one; otherwise let Stripe create it.
    ...(user?.stripeCustomerId
      ? { customer: user.stripeCustomerId }
      : user?.email
        ? { customer_email: user.email }
        : {}),
    allow_promotion_codes: true,
    success_url: `${botDeepLink()}?start=paid`,
    cancel_url: `${botDeepLink()}?start=cancelled`,
  });

  if (!session.url) throw new Error('Stripe did not return a Checkout URL');
  return session.url;
}

/** Create a Billing Portal session so a user can manage/cancel/fix their card. */
export async function createBillingPortalSession(stripeCustomerId: string): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: botDeepLink(),
  });
  return session.url;
}
