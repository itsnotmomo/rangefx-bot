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
 * Build the "My Membership" view: plan, customer-facing status, next payment /
 * access-end date, and access state. Buttons: Manage Payment or Cancel (URL,
 * when billing is on file), Get a New Group Link (ONLY while access is
 * active), Get Help, Back. Falls back to the plan picker when the user has
 * never subscribed.
 */
export async function renderStatus(telegramUserId: bigint): Promise<RenderedStatus> {
  const user = await getUser(telegramUserId);
  const sub = await getLatestSubscription(telegramUserId);

  if (!sub) {
    return { text: t('status.none'), keyboard: await plansKeyboard() };
  }

  const planLabel = sub.plan ? PLANS[sub.plan as PlanKey]?.label ?? sub.plan : '—';
  const hasAccess = await hasLiveGroupGrant(telegramUserId);
  const endDate = fmtDate(sub.currentPeriodEnd);

  const lines = [t('status.header'), '', t('status.plan_line', { plan: planLabel })];

  if (sub.cancelAtPeriodEnd) {
    lines.push(
      t('status.cancel_line'),
      t('status.ends_line', { date: endDate }),
      t('status.access_line', {
        state: hasAccess ? t('status.access.until', { date: endDate }) : t('status.access.paused'),
      }),
    );
  } else {
    lines.push(t('status.status_line', { status: statusLabel(sub.status) }));
    if (sub.currentPeriodEnd) {
      lines.push(t('status.next_payment_line', { date: endDate }));
    }
    lines.push(
      t('status.access_line', {
        state: hasAccess ? t('status.access.active') : t('status.access.paused'),
      }),
    );
  }

  let keyboard = new InlineKeyboard();
  if (user?.stripeCustomerId) {
    try {
      const portalUrl = await createBillingPortalSession(user.stripeCustomerId);
      keyboard = billingButton(portalUrl);
    } catch {
      lines.push('', t('status.portal_unavailable'));
    }
  }
  // A fresh single-use group link is only offered while access is active.
  if (hasAccess) {
    keyboard.row().text(t('kb.fresh_invite'), 'invite:fresh');
  }
  keyboard.row().text(t('kb.support'), 'menu:support');
  keyboard.row().text(t('kb.back'), 'menu:home');

  return { text: lines.join('\n'), keyboard };
}
