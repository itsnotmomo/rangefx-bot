import { PLANS } from '../config/index.js';

/**
 * All user-facing copy lives here. Voice: restrained and plain. No hype, no
 * "gurus", no exclamation-mark salesmanship. State what a thing is and move on.
 */

export const WELCOME = [
  'Range Compound.',
  '',
  'This bot manages access to the members’ group and your subscription.',
  'Nothing here is financial advice.',
  '',
  'Use the buttons below to view plans, check your subscription, or reach support.',
].join('\n');

export const ABOUT = [
  'About Range Compound',
  '',
  'A members’ group for people who take position sizing and risk seriously.',
  'Access is by subscription. You can cancel at any time from your subscription page.',
  '',
  'Payments are handled by Stripe. This bot never sees your card details.',
].join('\n');

export const SUPPORT = [
  'Support',
  '',
  '• Manage or cancel your subscription: open “My Subscription”, then “Manage billing”.',
  '• Didn’t get your group invite? Open “My Subscription” — if your plan is active you can request a fresh link.',
  '• Payment failed? You’ll get a message with a link to update your card. There’s a short grace period before access pauses.',
  '',
  'Still stuck? Reply here and an admin will follow up.',
].join('\n');

export function plansText(): string {
  const lines = [
    'Plans',
    '',
    'Same access on every plan. Longer terms cost less per month.',
    '',
  ];
  for (const plan of Object.values(PLANS)) {
    lines.push(`• ${plan.label} — ${plan.cadence}`);
  }
  lines.push('', 'Choose a plan below to continue to secure checkout.');
  return lines.join('\n');
}

export const PAST_DUE_DM = (portalUrl: string) =>
  [
    'A payment on your Range Compound subscription didn’t go through.',
    '',
    'You still have access for now. Update your card here to avoid interruption:',
    portalUrl,
  ].join('\n');

export const GRACE_WARNING_DM = (portalUrl: string, graceDays: number) =>
  [
    'Your Range Compound payment is still failing.',
    '',
    `Access will pause in about ${graceDays} day(s) unless the payment is fixed.`,
    'Update your card here:',
    portalUrl,
  ].join('\n');

export const ACCESS_REVOKED_DM = [
  'Your Range Compound subscription has ended and group access has been removed.',
  '',
  'No hard feelings. If you resubscribe later, you’ll get a fresh invite automatically.',
].join('\n');

export const CANCELLED_AT_PERIOD_END_DM = (dateStr: string) =>
  [
    'Your subscription is set to cancel.',
    '',
    `You’ll keep access until ${dateStr}. You can undo this anytime from “Manage billing”.`,
  ].join('\n');
