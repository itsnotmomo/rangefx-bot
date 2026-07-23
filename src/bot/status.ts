import { InlineKeyboard } from 'grammy';
import { PLANS, type PlanKey } from '../config/index.js';
import { getUser } from '../services/users.js';
import { getLatestSubscription } from '../services/subscriptions.js';
import { hasLiveGroupGrant } from '../access/grants.js';
import { createBillingPortalSession } from '../stripe/checkout.js';
import { billingButton, plansKeyboard } from './keyboards.js';

function fmtDate(d: Date | null): string {
  if (!d) return 'unknown';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  trialing: 'Trialing',
  past_due: 'Payment failing',
  canceled: 'Cancelled',
  unpaid: 'Unpaid',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
};

export interface RenderedStatus {
  text: string;
  keyboard: InlineKeyboard;
}

/**
 * Build the "My Subscription" view: plan, status, renewal date, and a Billing
 * Portal link when we have a Stripe customer on file. Falls back to the plan
 * picker when the user has never subscribed.
 */
export async function renderStatus(telegramUserId: bigint): Promise<RenderedStatus> {
  const user = await getUser(telegramUserId);
  const sub = await getLatestSubscription(telegramUserId);

  if (!sub) {
    return {
      text: [
        'You don’t have a subscription yet.',
        '',
        'Pick a plan to join the desk.',
      ].join('\n'),
      keyboard: plansKeyboard(),
    };
  }

  const planLabel = sub.plan ? PLANS[sub.plan as PlanKey]?.label ?? sub.plan : '—';
  const statusLabel = STATUS_LABEL[sub.status] ?? sub.status;
  const hasAccess = await hasLiveGroupGrant(telegramUserId);

  const lines = [
    'Your subscription',
    '',
    `Plan: ${planLabel}`,
    `Status: ${statusLabel}`,
  ];
  if (sub.cancelAtPeriodEnd) {
    lines.push(`Ends: ${fmtDate(sub.currentPeriodEnd)} (cancellation scheduled)`);
  } else if (sub.currentPeriodEnd) {
    lines.push(`Renews: ${fmtDate(sub.currentPeriodEnd)}`);
  }
  lines.push(`Group access: ${hasAccess ? 'active' : 'not active'}`);

  let keyboard = new InlineKeyboard();
  if (user?.stripeCustomerId) {
    try {
      const portalUrl = await createBillingPortalSession(user.stripeCustomerId);
      keyboard = billingButton(portalUrl);
    } catch {
      lines.push('', 'Billing portal is temporarily unavailable — try again shortly.');
    }
  }
  // Authorised members can always get a fresh single-use invite link.
  if (hasAccess) {
    keyboard.row().text('Get a fresh group invite', 'invite:fresh');
  }
  keyboard.row().text('« Back', 'menu:home');

  return { text: lines.join('\n'), keyboard };
}
