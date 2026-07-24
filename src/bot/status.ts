import { InlineKeyboard } from 'grammy';
import { PLANS, type PlanKey } from '../config/index.js';
import { getUser } from '../services/users.js';
import { getLatestSubscription } from '../services/subscriptions.js';
import { hasLiveGroupGrant } from '../access/grants.js';
import { createBillingPortalSession } from '../stripe/checkout.js';
import { statusLabel, t } from './content.js';
import { billingButton, plansKeyboard } from './keyboards.js';

function fmtDate(d: Date | null): string {
  if (!d) return 'unknown';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
    return { text: t('status.none'), keyboard: plansKeyboard() };
  }

  const planLabel = sub.plan ? PLANS[sub.plan as PlanKey]?.label ?? sub.plan : '—';
  const hasAccess = await hasLiveGroupGrant(telegramUserId);

  const lines = [
    t('status.header'),
    '',
    t('status.plan_line', { plan: planLabel }),
    t('status.status_line', { status: statusLabel(sub.status) }),
  ];
  if (sub.cancelAtPeriodEnd) {
    lines.push(t('status.ends_line', { date: fmtDate(sub.currentPeriodEnd) }));
  } else if (sub.currentPeriodEnd) {
    lines.push(t('status.renews_line', { date: fmtDate(sub.currentPeriodEnd) }));
  }
  lines.push(t('status.access_line', { state: t(hasAccess ? 'status.access.active' : 'status.access.inactive') }));

  let keyboard = new InlineKeyboard();
  if (user?.stripeCustomerId) {
    try {
      const portalUrl = await createBillingPortalSession(user.stripeCustomerId);
      keyboard = billingButton(portalUrl);
    } catch {
      lines.push('', t('status.portal_unavailable'));
    }
  }
  // Authorised members can always get a fresh single-use invite link.
  if (hasAccess) {
    keyboard.row().text(t('kb.fresh_invite'), 'invite:fresh');
  }
  keyboard.row().text(t('kb.back'), 'menu:home');

  return { text: lines.join('\n'), keyboard };
}
