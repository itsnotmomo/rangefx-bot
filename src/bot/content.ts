/**
 * All user-facing copy lives here, behind `t(key)`. This is the FINAL,
 * approved copy specification — implemented verbatim. Do not rewrite, soften,
 * or editorialize; propose changes against the spec, then update here and in
 * COPY.md together.
 *
 * Language groundwork: every handler reads strings through `t()`, so adding
 * Italian later means adding an `it` dictionary here and a language argument —
 * no handler changes.
 *
 * Track-record figures mirror the stats section of rangecompound.com
 * (retrieved 24 Jul 2026). Update BOTH places together, never one.
 *
 * Instrument names come from the shared display map in util/instruments.ts, so
 * the plans copy and the calendar messages can never name the same instrument
 * differently.
 */

import { instrumentName } from '../util/instruments.js';

const en = {
  // ---- /start ------------------------------------------------------------
  'welcome': [
    'Welcome to The Range Compound',
    '',
    'Where you can join a team of professional traders and operate alongside them.',
    '',
    'Inside The Compound, you see how the team operates in real time — and you can copy their positions and profit alongside them, with the key levels, the executions, and the reasoning behind every trade.',
    '',
    'Press the button “🚀 Join The Compound” or “❓ How It Works” for more info!',
    '',
    'Choose an option below.',
  ].join('\n'),

  'payment.return': [
    'Payment received',
    '',
    'We are confirming your payment now.',
    '',
    'Your private link to enter The Compound will be sent in this chat automatically.',
    'It normally arrives within a minute or two.',
    '',
    'If it does not arrive, open My Membership and tap Get a New Group Link.',
  ].join('\n'),

  // ---- Plans / checkout ----------------------------------------------------
  'plans': [
    'Choose your membership',
    '',
    'Every plan gives you the exact same access to The Compound.',
    'The only difference is how often you pay:',
    '',
    'Monthly — maximum flexibility',
    'Quarterly — lower monthly cost',
    'Annual — lowest monthly cost',
    '',
    'Choose the option that works best for you.',
  ].join('\n'),

  'checkout.priced': [
    '{plan} Membership',
    '',
    'Price: {price}',
    'Payment: {cadence}',
    '',
    'Tap the button below to pay securely using your debit or credit card.',
    '',
    'Your payment is processed by Stripe. After payment, your private Telegram group link will be sent here automatically.',
    '',
    'Your membership renews automatically until you cancel. You can manage or cancel it at any time.',
    '',
    'Your private group link works once and expires after {hours} hours.',
  ].join('\n'),

  'checkout.unpriced': [
    '{plan} Membership',
    '',
    'Payment: {cadence}',
    '',
    'Tap the button below to see the price and pay securely using your debit or credit card.',
    '',
    'After payment, your private Telegram group link will be sent here automatically.',
    '',
    'Your membership renews automatically until you cancel.',
  ].join('\n'),

  // ---- After payment ---------------------------------------------------------
  'invite.dm': [
    'Welcome to The Compound',
    '',
    'Your membership is active.',
    'Tap the button below to enter the private group.',
    '',
    'This link belongs to you, works once, and expires after {hours} hours.',
    '',
    'Once you enter:',
    '• Turn on notifications',
    '• Read the pinned information',
    '• Say hello to the desk',
    '',
    'Entries, key levels, execution updates, and reasoning will be posted in the group as they happen.',
    '',
    'Need help at any point? Send a message to this bot.',
  ].join('\n'),

  'invite.fresh': [
    'Your new group link is ready',
    '',
    'Tap below to enter The Compound.',
    'This link works once and expires after {hours} hours.',
  ].join('\n'),

  // ---- Results -----------------------------------------------------------------
  'results': [
    'The Range Compound Results',
    '',
    'Do not take our word for it. Look at the record.',
    'Every position has been documented with its entry, stop, and exit.',
    '',
    'Trailing 12-month return: +67.7%',
    'Documented track record: 35 months',
    'Average win rate: 50%',
    'Positions logged: 1,090',
    'Best month: +16%',
    'Worst month: −2.5%',
    '',
    'Only one of the 35 documented months closed negative — and it remains part of the public record.',
    '',
    'No deleted losing months. No promises about what happens next. Just the complete record of what has already happened.',
    '',
    'Past performance does not guarantee future results. Your outcome depends on your own execution and risk management.',
  ].join('\n'),

  // ---- FAQ ------------------------------------------------------------------------
  'faq.intro': ['How can we help?', '', 'Choose a question below.'].join('\n'),

  'faq.what.q': 'What exactly is The Compound?',
  'faq.what.a': [
    'The Compound is a private Telegram group where you watch the Range trading desk operate live.',
    '',
    'You see exactly what the desk is trading — the key levels, the execution, and the reasoning behind every decision as it happens — and you get the opportunity to copy their trades in real time and profit alongside them.',
    '',
    'You remain responsible for your own trades. Capital at risk.',
  ].join('\n'),

  'faq.receive.q': 'What do I receive?',
  'faq.receive.a': [
    'Members receive the desk’s live entries, key levels, execution updates, and trading reasoning inside the private group.',
    '',
    'Every membership plan includes the same access. Longer plans simply cost less per month.',
  ].join('\n'),

  'faq.markets.q': 'Which markets do you trade?',
  'faq.markets.a': `Inside The Compound we trade ${instrumentName('EURUSD')}, ${instrumentName('XAUUSD')} and ${instrumentName('EURJPY')}.`,

  'faq.results.q': 'What results should I expect?',
  'faq.results.a': [
    'Inside the room, you can expect anywhere from 3% to 10% gain and 100 to 200 RR per month.',
    '',
    'Results may differ based on entry prices and risk management.',
    '',
    'Instead of making promises, we show you the complete documented record:',
    '35 months documented, 1,090 positions logged, and only one negative month.',
    '',
    'You can review the full month-by-month record before joining.',
  ].join('\n'),

  'faq.pay.q': 'How do I pay?',
  'faq.pay.a': [
    'Choose a monthly, quarterly, or annual membership.',
    'Then tap Pay by Card — Secure Checkout.',
    '',
    'You can pay using a debit or credit card through Stripe.',
    '',
    'Once payment succeeds, your private group link is sent in this chat automatically.',
    '',
    'Prefer to pay with crypto? Send a DM to @RANGESUPPORT.',
  ].join('\n'),

  'faq.renewals.q': 'How do renewals work?',
  'faq.renewals.a': [
    'Your membership renews automatically at the end of each billing period.',
    '',
    'Monthly memberships renew monthly, quarterly memberships renew every three months, and annual memberships renew yearly.',
    '',
    'You can manage or cancel your membership at any time from My Membership.',
  ].join('\n'),

  'faq.cancel.q': 'How do I cancel?',
  'faq.cancel.a': [
    'Open My Membership and tap Manage Payment or Cancel.',
    '',
    'You do not need to fill out a form or contact support.',
    '',
    'After cancelling, you keep access until the end of the period you have already paid for.',
  ].join('\n'),

  'faq.help.q': 'How do I get help?',
  'faq.help.a': [
    'Tap Get Help or send a normal message directly to this bot.',
    '',
    'Your message goes to the desk, and the reply will appear in this chat.',
  ].join('\n'),

  // ---- Support ---------------------------------------------------------------------
  'support': [
    'How can we help?',
    '',
    'Send your message directly in this chat.',
    'It will be sent to the Range desk, and the reply will appear here.',
    '',
    'Common problems',
    '',
    'To change your card or cancel, open My Membership and tap Manage Payment or Cancel.',
    'If your group link expired, open My Membership and tap Get a New Group Link.',
    'If a payment failed, use the update-card button sent to you. Your access remains active for a short grace period.',
  ].join('\n'),

  'support.ack': [
    'Message sent',
    '',
    'The Range desk has received your message and will reply in this chat.',
  ].join('\n'),

  // ---- Membership status view ---------------------------------------------------------
  'status.none': [
    'You are not a member yet',
    '',
    'Choose a membership below to enter The Compound.',
    'Every plan gives you the same access. Longer memberships cost less per month.',
  ].join('\n'),
  'status.header': 'Your Membership',
  'status.plan_line': 'Plan: {plan}',
  'status.status_line': 'Status: {status}',
  'status.cancel_line': 'Status: Cancellation scheduled',
  'status.ends_line': 'Access ends: {date}',
  'status.next_payment_line': 'Next payment: {date}',
  'status.access_line': 'Compound access: {state}',
  'status.access.active': 'Active',
  'status.access.paused': 'Paused',
  'status.access.until': 'Active until {date}',
  'status.portal_unavailable': 'We could not open your payment settings right now. Please try again shortly.',

  'status.label.active': 'Active',
  'status.label.trialing': 'Trial active',
  'status.label.past_due': 'Payment needs attention',
  'status.label.canceled': 'Cancelled',
  'status.label.unpaid': 'Payment needs attention',
  'status.label.incomplete': 'Payment incomplete',
  'status.label.incomplete_expired': 'Expired',

  // ---- Billing lifecycle DMs --------------------------------------------------------------
  'dm.past_due': [
    'Your payment did not go through',
    '',
    'Do not worry — your Compound access is still active during the payment grace period.',
    '',
    'Tap below to update your debit or credit card and prevent your access from being interrupted.',
  ].join('\n'),

  'dm.grace_warning': [
    'Payment still needs attention',
    '',
    'We still could not process your Range Compound payment.',
    'Your access will pause on {date} unless your payment method is updated.',
    '',
    'Tap below to update your card and keep your access active.',
  ].join('\n'),

  'dm.access_revoked': [
    'Your Compound access has paused',
    '',
    'Your membership has ended, so you have been removed from the private group.',
    '',
    'You can rejoin whenever you are ready. After a new payment, a fresh group link will be sent here automatically.',
  ].join('\n'),

  'dm.cancel_scheduled': [
    'Cancellation confirmed',
    '',
    'Your membership will not renew.',
    'You will keep full access to The Compound until {date}.',
    '',
    'You can reverse the cancellation before that date from My Membership → Manage Payment or Cancel.',
  ].join('\n'),

  'dm.plan_changed': [
    'Your membership has been updated',
    '',
    'New plan: {plan}',
    'New billing schedule: {cadence}',
    'Next payment: {date}',
    '',
    'Your access to The Compound remains active. You do not need a new group link.',
  ].join('\n'),

  'dm.plan_change_scheduled': [
    'Your plan change is scheduled',
    '',
    'Your membership will change to {plan} on {date}.',
    '',
    'Your current access remains active and nothing else needs to be done.',
  ].join('\n'),

  // ---- Lead follow-ups. Two touches maximum, then silence. --------------------------------
  'followup.1': [
    'Still deciding? Here is exactly what you receive.',
    '',
    'Inside The Compound, you can watch the Range desk operate in real time:',
    '• Live entries and key levels',
    '• Execution and position updates',
    '• The reasoning behind the trades',
    '• Access to the private member group',
    '',
    'Every plan gives you the same access.',
    'Choose your membership below when you are ready.',
  ].join('\n'),

  'followup.2': [
    'One final message from us',
    '',
    'Before you decide, here is the record:',
    '',
    '35 months documented',
    '1,090 positions logged',
    '+67.7% trailing 12-month return',
    'One negative month',
    '',
    'Every position is recorded with its entry, stop, and exit.',
    '',
    'We cannot promise what will happen next. We can only show you exactly what has already happened.',
    '',
    'If you want to watch the desk operate from inside, choose a membership below.',
    'We will not send you any more joining reminders after this message.',
  ].join('\n'),

  // ---- Errors and edge cases -----------------------------------------------------------------
  'error.checkout': [
    'Checkout could not open',
    '',
    'Something went wrong while opening the payment page.',
    'Tap below to try again. You have not been charged.',
  ].join('\n'),

  'error.invite': [
    'We could not create your group link',
    '',
    'Your membership is still active.',
    'Tap below to try again. If it continues, send us a message and we will help you enter.',
  ].join('\n'),

  'error.no_access': [
    'Your membership is not active',
    '',
    'A private group link can only be created for active members.',
    'Choose a membership below to rejoin The Compound.',
  ].join('\n'),

  'error.unknown_command': [
    'I did not understand that command',
    '',
    'Use one of the buttons below.',
    'To speak with the Range desk, simply send a normal message without starting it with “/”.',
  ].join('\n'),

  // ---- Button language (standardized) ----------------------------------------------------------
  'kb.join': '🚀 Join The Compound',
  'kb.results': '📊 See The Results',
  'kb.faq': '❓ How It Works',
  'kb.status': '👤 My Membership',
  'kb.support': '💬 Get Help',
  'kb.back': '⬅️ Back',
  'kb.main_menu': '⬅️ Main Menu',
  'kb.checkout': '💳 Pay by Card — Secure Checkout',
  'kb.billing': '💳 Manage Payment or Cancel',
  'kb.fresh_invite': '🔗 Get a New Group Link',
  'kb.enter': '🚪 Enter The Compound',
  'kb.choose_another': '⬅️ Choose Another Plan',
  'kb.website_months': '📊 View Every Month on the Website',
  'kb.more_questions': '❓ More Questions',
  'kb.open_membership': '👤 Open My Membership',
  'kb.view_membership': '👤 View My Membership',
  'kb.update_card': '💳 Update My Card',
  'kb.rejoin': '🔄 Rejoin The Compound',
  'kb.try_checkout': '🔄 Try Checkout Again',
  'kb.try_again': '🔄 Try Again',
  'kb.full_results': '📊 View Full Results',
  'kb.plan.monthly': '📅 Monthly — Most Flexible',
  'kb.plan.quarterly': '⭐ Quarterly — Better Value',
  'kb.plan.annual': '🏆 Annual — Best Value',
  'kb.plan.monthly_priced': '📅 Monthly — {price}',
  'kb.plan.quarterly_priced': '⭐ Quarterly — {price}',
  'kb.plan.annual_priced': '🏆 Annual — {price} · Best Value',
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

/** Customer-facing label for a Stripe subscription status; falls back to the raw value. */
export function statusLabel(status: string): string {
  const key = `status.label.${status}`;
  return key in en ? en[key as StringKey] : status;
}

// ---- Composed views ----------------------------------------------------------

export function plansText(): string {
  return t('plans');
}

/** Message that accompanies the "Pay by Card" checkout button. */
export function checkoutMessage(
  planLabel: string,
  price: string | null,
  cadence: string,
  inviteExpiryHours: number,
): string {
  return price
    ? t('checkout.priced', { plan: planLabel, price, cadence, hours: inviteExpiryHours })
    : t('checkout.unpriced', { plan: planLabel, cadence });
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

const FAQ_IDS = ['what', 'receive', 'markets', 'results', 'pay', 'renewals', 'cancel', 'help'] as const;

export const FAQ_ITEMS: FaqItem[] = FAQ_IDS.map((id) => ({
  id,
  question: t(`faq.${id}.q` as StringKey),
  answer: t(`faq.${id}.a` as StringKey),
}));
