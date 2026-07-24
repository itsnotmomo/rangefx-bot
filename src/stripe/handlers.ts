import type Stripe from 'stripe';
import { type Api } from 'grammy';
import { stripe } from './client.js';
import { createBillingPortalSession } from './checkout.js';
import { PLANS, PRICE_ID_TO_PLAN } from '../config/index.js';
import { log } from '../util/logger.js';
import { getUserByStripeCustomer, setStripeCustomerId, upsertUser } from '../services/users.js';
import { markPaid } from '../services/funnel.js';
import {
  getSubscriptionByStripeId,
  updateSubscriptionStatus,
  upsertSubscription,
} from '../services/subscriptions.js';
import { grantGroupAccess, hasLiveGroupGrant, revokeGroupAccess } from '../access/grants.js';
import { safeSendMessage } from '../telegram/safe.js';
import { t } from '../bot/content.js';
import {
  accessRemovedKeyboard,
  cancelScheduledKeyboard,
  planChangedKeyboard,
  updateCardKeyboard,
} from '../bot/keyboards.js';

function toDate(unixSeconds: number | null | undefined): Date | null {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'the end of the period';
}

/**
 * Resolve the Telegram user id behind a Stripe object. Priority:
 *   1. metadata.telegram_user_id (we stamp this on the subscription at checkout)
 *   2. the customer id -> users.stripe_customer_id lookup
 * Returns null if we genuinely can't tell (logged by the caller).
 */
async function resolveTelegramUserId(
  metadata: Stripe.Metadata | null | undefined,
  customerId: string | null | undefined,
): Promise<bigint | null> {
  const fromMeta = metadata?.telegram_user_id;
  if (fromMeta) {
    try {
      return BigInt(fromMeta);
    } catch {
      /* fall through */
    }
  }
  if (customerId) {
    const user = await getUserByStripeCustomer(customerId);
    if (user) return user.telegramUserId;
  }
  return null;
}

/** Ensure a users row exists for this id, attaching the Stripe customer id. */
async function ensureUser(telegramUserId: bigint, customerId: string | null, email?: string | null): Promise<void> {
  await upsertUser({
    telegramUserId,
    stripeCustomerId: customerId ?? null,
    email: email ?? null,
    source: 'bot',
  });
}

async function syncSubscription(telegramUserId: bigint, sub: Stripe.Subscription): Promise<void> {
  const priceId = sub.items.data[0]?.price.id ?? null;
  await upsertSubscription({
    telegramUserId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    status: sub.status,
    currentPeriodEnd: toDate(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

// ---------------------------------------------------------------------------
// checkout.session.completed — the buy path. Upsert, sync, grant access.
// ---------------------------------------------------------------------------
async function handleCheckoutCompleted(api: Api, event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== 'subscription') return;

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  const telegramUserId = await resolveTelegramUserId(
    { ...(session.metadata ?? {}), telegram_user_id: session.metadata?.telegram_user_id ?? session.client_reference_id ?? '' },
    customerId,
  );

  if (!telegramUserId) {
    log.error('checkout.session.completed without a resolvable telegram user', { session: session.id });
    return;
  }

  const email = session.customer_details?.email ?? null;
  await ensureUser(telegramUserId, customerId, email);
  if (customerId) await setStripeCustomerId(telegramUserId, customerId);
  // Funnel: converted. Cancels any scheduled follow-up touches.
  await markPaid(telegramUserId);

  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (subId) {
    const sub = await stripe.subscriptions.retrieve(subId);
    await syncSubscription(telegramUserId, sub);
  }

  // Grant access (mints a single-use invite link + DMs it + records the grant).
  await grantGroupAccess(api, telegramUserId, 'checkout.session.completed');
}

// ---------------------------------------------------------------------------
// invoice.paid — renewal succeeded. Refresh period end, ensure access is live.
// ---------------------------------------------------------------------------
async function handleInvoicePaid(api: Api, event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
  if (!subId) return;

  const sub = await stripe.subscriptions.retrieve(subId);
  const telegramUserId = await resolveTelegramUserId(sub.metadata, customerId);
  if (!telegramUserId) {
    log.error('invoice.paid without a resolvable telegram user', { invoice: invoice.id, subId });
    return;
  }

  await ensureUser(telegramUserId, customerId);
  await syncSubscription(telegramUserId, sub);
  await markPaid(telegramUserId);

  // A previously past_due user who paid, or anyone missing a live grant, is
  // (re)granted access here so billing and access never drift apart.
  if (sub.status === 'active' || sub.status === 'trialing') {
    if (!(await hasLiveGroupGrant(telegramUserId))) {
      await grantGroupAccess(api, telegramUserId, 'invoice.paid');
    }
  }
}

// ---------------------------------------------------------------------------
// invoice.payment_failed — mark past_due, nudge the user. No removal (grace).
// ---------------------------------------------------------------------------
async function handlePaymentFailed(api: Api, event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
  if (!subId) return;

  const telegramUserId = await resolveTelegramUserId(null, customerId);
  if (subId) await updateSubscriptionStatus(subId, 'past_due');

  if (!telegramUserId) {
    log.warn('payment_failed without a resolvable telegram user', { invoice: invoice.id });
    return;
  }

  // The billing link travels as a URL button; omitted if the portal is down.
  let portalUrl: string | null = null;
  if (customerId) {
    try {
      portalUrl = await createBillingPortalSession(customerId);
    } catch (err) {
      log.warn('could not create portal session for past_due DM', { telegramUserId, error: err });
    }
  }
  await safeSendMessage(api, telegramUserId, t('dm.past_due'), {
    reply_markup: updateCardKeyboard(portalUrl),
  });
  log.info('subscription past_due', { telegramUserId, subId });
}

// ---------------------------------------------------------------------------
// customer.subscription.updated — sync status, plan, cancel flag.
// ---------------------------------------------------------------------------
async function handleSubscriptionUpdated(api: Api, event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const telegramUserId = await resolveTelegramUserId(sub.metadata, customerId);
  if (!telegramUserId) {
    log.warn('subscription.updated without a resolvable telegram user', { subId: sub.id });
    return;
  }

  await ensureUser(telegramUserId, customerId);
  const prev = await getSubscriptionByStripeId(sub.id);
  await syncSubscription(telegramUserId, sub);

  // Newly scheduled cancellation -> confirmation (access continues for now).
  if (sub.cancel_at_period_end && !prev?.cancelAtPeriodEnd) {
    await safeSendMessage(api, telegramUserId, t('dm.cancel_scheduled', { date: fmtDate(toDate(sub.current_period_end)) }), {
      reply_markup: cancelScheduledKeyboard(),
    });
  }

  // Immediate plan change -> confirmation with the new plan and next payment.
  const newPriceId = sub.items.data[0]?.price.id ?? null;
  const newPlanKey = newPriceId ? PRICE_ID_TO_PLAN[newPriceId] : undefined;
  if (prev?.plan && newPlanKey && prev.plan !== newPlanKey) {
    const plan = PLANS[newPlanKey];
    await safeSendMessage(
      api,
      telegramUserId,
      t('dm.plan_changed', {
        plan: plan.label,
        cadence: plan.cadence,
        date: fmtDate(toDate(sub.current_period_end)),
      }),
      { reply_markup: planChangedKeyboard() },
    );
  }

  // Scheduled plan change (billing portal "switch at period end" attaches a
  // subscription schedule) -> tell the user when it takes effect. Detected by
  // the schedule appearing in this update's previous_attributes diff.
  const prevAttrs = event.data.previous_attributes as Partial<Stripe.Subscription> | undefined;
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id;
  if (scheduleId && prevAttrs && 'schedule' in prevAttrs && !prevAttrs.schedule) {
    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      const nowSec = Math.floor(Date.now() / 1000);
      const upcoming = schedule.phases.find((p) => p.start_date > nowSec);
      const upPrice = upcoming?.items[0]?.price;
      const upPriceId = typeof upPrice === 'string' ? upPrice : upPrice?.id;
      const upPlanKey = upPriceId ? PRICE_ID_TO_PLAN[upPriceId] : undefined;
      if (upcoming && upPlanKey && upPlanKey !== newPlanKey) {
        await safeSendMessage(
          api,
          telegramUserId,
          t('dm.plan_change_scheduled', {
            plan: PLANS[upPlanKey].label,
            date: fmtDate(new Date(upcoming.start_date * 1000)),
          }),
        );
      }
    } catch (err) {
      log.warn('could not resolve scheduled plan change', { telegramUserId, scheduleId, error: err });
    }
  }

  // Recovered to active and somehow without a grant -> restore access.
  if ((sub.status === 'active' || sub.status === 'trialing') && !(await hasLiveGroupGrant(telegramUserId))) {
    await grantGroupAccess(api, telegramUserId, 'subscription.updated:active');
  }
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted — end of the line. Revoke access.
// ---------------------------------------------------------------------------
async function handleSubscriptionDeleted(api: Api, event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const telegramUserId = await resolveTelegramUserId(sub.metadata, customerId);

  await updateSubscriptionStatus(sub.id, 'canceled');

  if (!telegramUserId) {
    log.warn('subscription.deleted without a resolvable telegram user', { subId: sub.id });
    return;
  }

  await revokeGroupAccess(api, telegramUserId, 'customer.subscription.deleted', {
    dm: true,
    notice: t('dm.access_revoked'),
    noticeKeyboard: accessRemovedKeyboard(),
  });
}

/** Dispatch a verified Stripe event to its handler. Unknown types are ignored. */
export async function dispatchStripeEvent(api: Api, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(api, event);
    case 'invoice.paid':
      return handleInvoicePaid(api, event);
    case 'invoice.payment_failed':
      return handlePaymentFailed(api, event);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(api, event);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(api, event);
    default:
      log.debug('unhandled stripe event', { type: event.type });
  }
}
