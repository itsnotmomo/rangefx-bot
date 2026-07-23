import { PLANS } from '../config/index.js';

/**
 * All user-facing copy lives here. Voice: restrained, plain, confident. No
 * hype, no exclamation marks, no guru language. Persuasion comes from clarity,
 * proof, and structure — never pressure.
 *
 * [ELIAS: ...] markers flag every claim, figure, or positioning statement that
 * needs sign-off. They render verbatim to users until replaced — treat any
 * remaining marker as a launch blocker.
 */

// ---------------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------------

export const WELCOME = [
  'Range Compound.',
  '',
  'The Compound is a working trading desk you can see inside. [ELIAS: approve positioning]',
  'Members get the desk’s execution, levels, and reasoning — in real time. [ELIAS: approve]',
  'Nothing here is financial advice.',
].join('\n');

/** Shown when the user returns from Stripe via the success deep link (?start=paid). */
export const PAYMENT_RETURN = [
  'Thanks — your payment is processing.',
  '',
  'Your personal group invite will arrive in this chat within a minute or two.',
  'If it doesn’t, open “My Subscription” and request a fresh link.',
].join('\n');

// ---------------------------------------------------------------------------
// Plans / checkout
// ---------------------------------------------------------------------------

export function plansText(): string {
  const lines = [
    'Join the Desk',
    '',
    'Same access on every plan. Longer terms cost less per month.',
    '',
  ];
  for (const plan of Object.values(PLANS)) {
    lines.push(`• ${plan.label} — ${plan.cadence}`);
  }
  lines.push('', 'Pick a plan to continue to secure checkout.');
  return lines.join('\n');
}

/** Message that accompanies the "Open secure checkout" button. */
export const CHECKOUT_MESSAGE = (
  planLabel: string,
  price: string | null,
  cadence: string,
  inviteExpiryHours: number,
) =>
  [
    price ? `${planLabel} — ${price}, ${cadence}.` : `${planLabel} — ${cadence}.`,
    '',
    'Payment runs through Stripe’s secure checkout. The moment it succeeds, your personal group invite arrives in this chat.',
    `The invite is yours alone — it works once and expires in ${inviteExpiryHours} hours.`,
  ].join('\n');

/** DM sent with the group invite after successful payment. */
export const GROUP_INVITE_DM = (inviteLink: string, inviteExpiryHours: number) =>
  [
    'You’re in.',
    '',
    `Your personal invite — works once, expires in ${inviteExpiryHours} hours:`,
    inviteLink,
    '',
    'Once inside, say hello in the introductions topic. [ELIAS: confirm topic name]',
    'The desk posts signals and levels in the topics as they happen. [ELIAS: approve]',
    'Need anything? Message this bot — it reaches the desk directly.',
  ].join('\n');

/** Re-issued invite for an already-authorised member (from "My Subscription"). */
export const FRESH_INVITE = (inviteLink: string, inviteExpiryHours: number) =>
  [
    `Your fresh invite — works once, expires in ${inviteExpiryHours} hours:`,
    inviteLink,
  ].join('\n');

// ---------------------------------------------------------------------------
// Lead follow-ups. Two touches maximum, then silence. Silence is on-brand.
// ---------------------------------------------------------------------------

/** Touch 1 (+1 hour): answer the implicit objection — what The Compound is. */
export const FOLLOWUP_1 = [
  'One line, in case it wasn’t clear:',
  '',
  'The Compound is a live look inside a working trading desk — its execution, levels, and reasoning, as they happen. [ELIAS: approve positioning]',
  '',
  'Plans below if you want in.',
].join('\n');

/** Touch 2 (+24 hours): concrete proof, then leave them alone. */
export const FOLLOWUP_2 = [
  'Two facts, then we’ll leave it with you:',
  '',
  '• [ELIAS: insert real verified figure — e.g. audited return over a defined period]',
  '• [ELIAS: insert real verified figure — e.g. track length or sample size]',
  '',
  'If that’s what you’re looking for, the plans are below.',
  'Either way, this is the last message you’ll get about it.',
].join('\n');

// ---------------------------------------------------------------------------
// Results (static frame — no invented numbers anywhere)
// ---------------------------------------------------------------------------

export const RESULTS = [
  'Results',
  '',
  'The desk trades EURUSD, XAUUSD, and EURJPY.',
  '',
  'The approach: trade the range, not the prediction. [ELIAS: approve approach line 1]',
  'Small, controlled wins, compounded. [ELIAS: approve approach line 2]',
  '',
  'Track record:',
  '[ELIAS: real verified figures only — nothing ships without them]',
].join('\n');

// ---------------------------------------------------------------------------
// FAQ (absorbs the old About content)
// ---------------------------------------------------------------------------

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export const FAQ_INTRO = ['FAQ', '', 'Pick a question.'].join('\n');

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'what',
    question: 'What is this?',
    answer:
      'The Compound is a private members’ group run by a working trading desk, for people who take position sizing and risk seriously. [ELIAS: approve] Access is by subscription. Payments are handled by Stripe — this bot never sees your card details.',
  },
  {
    id: 'get',
    question: 'What do I get?',
    answer:
      'The desk’s execution, levels, and reasoning, posted in the group topics as they happen. [ELIAS: confirm exactly what members see] Same access on every plan — longer terms simply cost less per month.',
  },
  {
    id: 'payments',
    question: 'How do payments work?',
    answer:
      'Subscriptions are billed by Stripe through secure checkout — monthly, quarterly, or annual. Your card details never touch this bot. The moment payment succeeds, your personal group invite arrives here automatically.',
  },
  {
    id: 'cancel',
    question: 'How do I cancel?',
    answer:
      'Anytime, from “My Subscription” → “Manage billing”. No forms, no questions. Access runs to the end of the period you’ve paid for.',
  },
  {
    id: 'advice',
    question: 'Is this financial advice?',
    answer:
      'No. Nothing here is financial advice or a recommendation to trade. It’s a live look at how one desk operates — what you do with your own capital is your decision alone.',
  },
  {
    id: 'help',
    question: 'How do I get help?',
    answer:
      'Message this bot. Anything you send here goes straight to the desk, and the reply lands in this chat.',
  },
];

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

export const SUPPORT = [
  'Support',
  '',
  'Send a message here — it goes straight to the desk. Replies land in this chat.',
  '',
  'Quick answers:',
  '• Manage or cancel: “My Subscription” → “Manage billing”.',
  '• Missing group invite? Open “My Subscription” — if your access is active you can request a fresh link.',
  '• Payment failed? You’ll receive a link to update your card. There’s a short grace period before access pauses.',
].join('\n');

/** Acknowledgement after a support message is relayed to the admins. */
export const SUPPORT_ACK = 'Received. The desk will reply here.';

// ---------------------------------------------------------------------------
// Billing lifecycle DMs
// ---------------------------------------------------------------------------

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
