import { PLANS } from '../config/index.js';

/**
 * All user-facing copy lives here, behind `t(key)`. Voice: restrained, plain,
 * confident. No hype, no exclamation marks, no emojis in body text. Persuasion
 * comes from clarity, proof, and structure — never pressure.
 *
 * Language groundwork: every handler reads strings through `t()`, so adding
 * Italian later means adding an `it` dictionary here and a language argument —
 * no handler changes. All copy is final; nothing renders as a placeholder.
 *
 * Track-record figures mirror the stats section of rangecompound.com exactly
 * (retrieved 24 Jul 2026). Update BOTH places together, never one.
 */

const en = {
  // ---- /start ------------------------------------------------------------
  'welcome': [
    'Range Compound.',
    '',
    'The Compound is a working trading desk you watch operate from the inside.',
    'Members get the desk’s execution, levels, and reasoning — in real time.',
  ].join('\n'),

  'payment.return': [
    'Thanks — your payment is processing.',
    '',
    'Your personal invite will arrive in this chat within a minute or two.',
    'If it doesn’t, open “My Subscription” and request a fresh link.',
  ].join('\n'),

  // ---- Plans / checkout ----------------------------------------------------
  'plans.intro': [
    'Join The Compound',
    '',
    'Same access on every plan. Longer terms cost less per month.',
  ].join('\n'),
  'plans.cta': 'Pick a plan to continue to secure checkout.',

  'checkout.priced': '{plan} — {price}, {cadence}.',
  'checkout.unpriced': '{plan} — {cadence}.',
  'checkout.body': [
    'Payment runs through Stripe’s secure checkout. The moment it succeeds, your personal invite arrives in this chat.',
    'The invite is yours alone — it works once and expires in {hours} hours.',
  ].join('\n'),

  'invite.dm': [
    'You’re in.',
    '',
    'Your personal invite — works once, expires in {hours} hours:',
    '{link}',
    '',
    'Say hello when you land — the desk reads everything.',
    'Levels and execution post in the group as they happen.',
    'Need anything? Message this bot — it reaches the desk directly.',
  ].join('\n'),

  'invite.fresh': [
    'Your fresh invite — works once, expires in {hours} hours:',
    '{link}',
  ].join('\n'),

  // ---- Lead follow-ups. Two touches maximum, then silence. -----------------
  'followup.1': [
    'One line, in case it wasn’t clear:',
    '',
    'The Compound is a live look inside a working trading desk — its execution, levels, and reasoning, as they happen.',
    '',
    'Plans below if you want in.',
  ].join('\n'),

  'followup.2': [
    'Two facts, then we’ll leave it with you:',
    '',
    '33 months documented, month by month, since October 2023 — one closed negative, and it stayed on the record.',
    '+72.3% trailing 12-month return across 1,059 logged positions.',
    '',
    'If that’s what you’re looking for, the plans are below.',
    'Either way, this is the last message you’ll get about it.',
  ].join('\n'),

  // ---- Results (mirrors rangecompound.com's track-record section) ----------
  'results': [
    'Results',
    '',
    'Documented month by month since October 2023. Every position logged — entry, stop, and exit.',
    '',
    '+72.3% — trailing 12-month return (sum of the last twelve documented months)',
    '33 — months documented, unbroken',
    '49% — average win rate across every logged position',
    '1,059 — positions logged',
    '+16% — best month (November 2023)',
    '−2.5% — worst month (June 2025)',
    '',
    'Of 33 months, one closed negative — and it stayed on the record.',
    '',
    'Past performance does not guarantee future results; every outcome depends on your own execution and risk control.',
    '',
    'The full month-by-month record is on the site.',
  ].join('\n'),

  // ---- FAQ ------------------------------------------------------------------
  'faq.intro': ['FAQ', '', 'Pick a question.'].join('\n'),

  'faq.what.q': 'What is The Compound, exactly?',
  'faq.what.a':
    'The Compound shares its own live trading — entries, levels, reasoning — as it happens. Members watch the desk work in real time. What you do with your own capital is your decision.',

  'faq.get.q': 'What do I get as a member?',
  'faq.get.a':
    'The desk’s entries, levels, and reasoning, posted in the group as they happen. Same access on every plan — longer terms simply cost less per month.',

  'faq.pairs.q': 'Which pairs does the desk trade?',
  'faq.pairs.a':
    'EURUSD, XAUUSD, and EURJPY. The desk trades the range, not the prediction — small, controlled wins, compounded.',

  'faq.results.q': 'What results can I expect?',
  'faq.results.a':
    'Look at the record, not at promises. The Results section here carries the desk’s documented figures, and the full month-by-month table is at rangecompound.com. Real numbers only — 33 months on the record, one negative.',

  'faq.payments.q': 'How do payments and renewals work?',
  'faq.payments.a':
    'Billed by Stripe through secure checkout — monthly, quarterly, or annual. Renewal is automatic until you cancel. Your card details never touch this bot, and your invite arrives here the moment payment succeeds.',

  'faq.cancel.q': 'How do I cancel?',
  'faq.cancel.a':
    'Anytime, from “My Subscription” → “Manage billing”. No forms, no questions. Access runs to the end of the period you’ve paid for.',

  'faq.help.q': 'How do I get help?',
  'faq.help.a':
    'Message this bot. It reaches the desk directly, and the reply lands in this chat.',

  // ---- Support ---------------------------------------------------------------
  'support': [
    'Support',
    '',
    'Send a message here — it goes straight to the desk. Replies land in this chat.',
    '',
    'Quick answers:',
    '• Manage or cancel: “My Subscription” → “Manage billing”.',
    '• Missing invite? Open “My Subscription” — if your access is active you can request a fresh link.',
    '• Payment failed? You’ll receive a link to update your card. There’s a short grace period before access pauses.',
  ].join('\n'),

  'support.ack': 'Received. The desk will reply here.',

  // ---- Subscription status view ----------------------------------------------
  'status.none': [
    'You don’t have a subscription yet.',
    '',
    'Pick a plan to join The Compound.',
  ].join('\n'),
  'status.header': 'Your subscription',
  'status.plan_line': 'Plan: {plan}',
  'status.status_line': 'Status: {status}',
  'status.ends_line': 'Ends: {date} (cancellation scheduled)',
  'status.renews_line': 'Renews: {date}',
  'status.access_line': 'Group access: {state}',
  'status.access.active': 'active',
  'status.access.inactive': 'not active',
  'status.portal_unavailable': 'Billing portal is temporarily unavailable — try again shortly.',

  'status.label.active': 'Active',
  'status.label.trialing': 'Trialing',
  'status.label.past_due': 'Payment failing',
  'status.label.canceled': 'Cancelled',
  'status.label.unpaid': 'Unpaid',
  'status.label.incomplete': 'Incomplete',
  'status.label.incomplete_expired': 'Expired',

  // ---- Errors ------------------------------------------------------------------
  'error.checkout': 'Couldn’t start checkout just now. Please try again in a moment.',
  'error.invite': 'Couldn’t create an invite just now. Try again in a moment.',
  'error.no_access': 'Your access isn’t active. Pick a plan to join The Compound.',

  // ---- Billing lifecycle DMs -----------------------------------------------------
  'dm.past_due': [
    'A payment on your Range Compound subscription didn’t go through.',
    '',
    'You still have access for now. Update your card here to avoid interruption:',
    '{portalUrl}',
  ].join('\n'),

  'dm.grace_warning': [
    'Your Range Compound payment is still failing.',
    '',
    'Access will pause in about {days} day(s) unless the payment is fixed.',
    'Update your card here:',
    '{portalUrl}',
  ].join('\n'),

  'dm.access_revoked': [
    'Your Range Compound subscription has ended and group access has been removed.',
    '',
    'No hard feelings. If you resubscribe later, you’ll get a fresh invite automatically.',
  ].join('\n'),

  'dm.cancel_scheduled': [
    'Your subscription is set to cancel.',
    '',
    'You’ll keep access until {date}. You can undo this anytime from “Manage billing”.',
  ].join('\n'),

  // ---- Keyboard labels --------------------------------------------------------------
  'kb.join': 'Join The Compound',
  'kb.results': 'Results',
  'kb.faq': 'FAQ',
  'kb.status': 'My Subscription',
  'kb.support': 'Support',
  'kb.back': '« Back',
  'kb.checkout': 'Open secure checkout',
  'kb.billing': 'Manage billing',
  'kb.fresh_invite': 'Get a fresh group invite',
  'kb.more_questions': 'More questions',
  'kb.website': 'rangecompound.com',
} as const;

export type StringKey = keyof typeof en;

/**
 * Look up a copy string and interpolate `{var}` placeholders. English-only for
 * now; a future `it` dictionary slots in behind this same signature.
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let s: string = en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Human label for a Stripe subscription status; falls back to the raw value. */
export function statusLabel(status: string): string {
  const key = `status.label.${status}`;
  return key in en ? en[key as StringKey] : status;
}

// ---- Composed views ----------------------------------------------------------

export function plansText(): string {
  const lines = [t('plans.intro'), ''];
  for (const plan of Object.values(PLANS)) {
    lines.push(`• ${plan.label} — ${plan.cadence}`);
  }
  lines.push('', t('plans.cta'));
  return lines.join('\n');
}

/** Message that accompanies the "Open secure checkout" button. */
export function checkoutMessage(
  planLabel: string,
  price: string | null,
  cadence: string,
  inviteExpiryHours: number,
): string {
  const headline = price
    ? t('checkout.priced', { plan: planLabel, price, cadence })
    : t('checkout.unpriced', { plan: planLabel, cadence });
  return [headline, '', t('checkout.body', { hours: inviteExpiryHours })].join('\n');
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const FAQ_IDS = ['what', 'get', 'pairs', 'results', 'payments', 'cancel', 'help'] as const;

export const FAQ_ITEMS: FaqItem[] = FAQ_IDS.map((id) => ({
  id,
  question: t(`faq.${id}.q` as StringKey),
  answer: t(`faq.${id}.a` as StringKey),
}));
