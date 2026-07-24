import { InlineKeyboard } from 'grammy';
import { PLANS, type PlanKey } from '../config/index.js';
import { priceDisplay } from '../stripe/prices.js';
import { FAQ_ITEMS, t, type StringKey } from './content.js';

/**
 * Standardized button language lives in content.ts (kb.* keys). Layout rules:
 * the main menu leads with the one action that matters (join), full width;
 * sub-menus put action buttons first and the back button last, full width.
 * Invite links and billing links are always URL buttons, never raw URLs.
 */

/** Main menu shown by /start. */
export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.join'), 'menu:plans')
    .row()
    .text(t('kb.results'), 'menu:results')
    .text(t('kb.faq'), 'menu:faq')
    .row()
    .text(t('kb.status'), 'menu:status')
    .text(t('kb.support'), 'menu:support');
}

// ---- Plan buttons (live prices whenever available) --------------------------

const PLAN_LABEL_KEY: Record<PlanKey, StringKey> = {
  monthly: 'kb.plan.monthly',
  quarterly: 'kb.plan.quarterly',
  annual: 'kb.plan.annual',
};

const PLAN_PRICED_KEY: Record<PlanKey, StringKey> = {
  monthly: 'kb.plan.monthly_priced',
  quarterly: 'kb.plan.quarterly_priced',
  annual: 'kb.plan.annual_priced',
};

/** "📅 Monthly — €79" when the price is available, tagline variant otherwise. */
async function planButtonLabel(key: PlanKey): Promise<string> {
  const price = await priceDisplay(PLANS[key].priceId);
  return price ? t(PLAN_PRICED_KEY[key], { price }) : t(PLAN_LABEL_KEY[key]);
}

/** Append one full-width row per plan. Callback data: plan:<key>. */
async function addPlanRows(kb: InlineKeyboard): Promise<InlineKeyboard> {
  for (const plan of Object.values(PLANS)) {
    kb.text(await planButtonLabel(plan.key), `plan:${plan.key}`).row();
  }
  return kb;
}

/** Plan picker: the three plans, then back. */
export async function plansKeyboard(): Promise<InlineKeyboard> {
  const kb = await addPlanRows(new InlineKeyboard());
  kb.text(t('kb.back'), 'menu:home');
  return kb;
}

/** Plans + Get Help — for "membership not active" moments. */
export async function noAccessKeyboard(): Promise<InlineKeyboard> {
  const kb = await addPlanRows(new InlineKeyboard());
  kb.text(t('kb.support'), 'menu:support');
  return kb;
}

/** Follow-up touch 1: plans + See The Results. */
export async function followup1Keyboard(): Promise<InlineKeyboard> {
  const kb = await addPlanRows(new InlineKeyboard());
  kb.text(t('kb.results'), 'menu:results');
  return kb;
}

/** Follow-up touch 2: plans + View Full Results. */
export async function followup2Keyboard(): Promise<InlineKeyboard> {
  const kb = await addPlanRows(new InlineKeyboard());
  kb.text(t('kb.full_results'), 'menu:results');
  return kb;
}

// ---- Checkout ----------------------------------------------------------------

/** Under the checkout message: pay (URL), then choose another plan. */
export function checkoutKeyboard(url: string): InlineKeyboard {
  return new InlineKeyboard()
    .url(t('kb.checkout'), url)
    .row()
    .text(t('kb.choose_another'), 'menu:plans');
}

/** Checkout failed: retry the SAME plan, pick another, or get help. */
export function checkoutErrorKeyboard(planKey: PlanKey): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.try_checkout'), `plan:${planKey}`)
    .row()
    .text(t('kb.choose_another'), 'menu:plans')
    .row()
    .text(t('kb.support'), 'menu:support');
}

// ---- Invites -------------------------------------------------------------------

/** The invite itself, as a URL button — never a raw link in text. */
export function enterButton(url: string): InlineKeyboard {
  return new InlineKeyboard().url(t('kb.enter'), url);
}

/** Reissued invite: enter + get help. */
export function freshInviteKeyboard(url: string): InlineKeyboard {
  return new InlineKeyboard().url(t('kb.enter'), url).row().text(t('kb.support'), 'menu:support');
}

/** Invite reissue failed: try again, get help, back. */
export function inviteErrorKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.try_again'), 'invite:fresh')
    .row()
    .text(t('kb.support'), 'menu:support')
    .row()
    .text(t('kb.back'), 'menu:home');
}

// ---- Billing lifecycle ------------------------------------------------------------

/** Update-card prompt; the URL button is omitted if no portal link exists. */
export function updateCardKeyboard(portalUrl: string | null): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (portalUrl) kb.url(t('kb.update_card'), portalUrl).row();
  kb.text(t('kb.support'), 'menu:support');
  return kb;
}

/** Access removed: rejoin (opens plan selection) + get help. */
export function accessRemovedKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.rejoin'), 'menu:plans')
    .row()
    .text(t('kb.support'), 'menu:support');
}

/** Cancellation confirmed: open membership + main menu. */
export function cancelScheduledKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.open_membership'), 'menu:status')
    .row()
    .text(t('kb.main_menu'), 'menu:home');
}

/** Plan changed: view membership + get help. */
export function planChangedKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.view_membership'), 'menu:status')
    .row()
    .text(t('kb.support'), 'menu:support');
}

// ---- Views -------------------------------------------------------------------------

/** After returning from Stripe with a successful payment. */
export function paymentReturnKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.status'), 'menu:status')
    .text(t('kb.support'), 'menu:support')
    .row()
    .text(t('kb.main_menu'), 'menu:home');
}

/** A single "Manage Payment or Cancel" URL button. */
export function billingButton(url: string): InlineKeyboard {
  return new InlineKeyboard().url(t('kb.billing'), url);
}

/** One button per FAQ question. Callback data: faq:<id>. */
export function faqKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const item of FAQ_ITEMS) {
    kb.text(item.question, `faq:${item.id}`).row();
  }
  kb.text(t('kb.back'), 'menu:home');
  return kb;
}

/** Under a FAQ answer: more questions, join, then back. */
export function faqAnswerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.more_questions'), 'menu:faq')
    .text(t('kb.join'), 'menu:plans')
    .row()
    .text(t('kb.back'), 'menu:home');
}

/** Under Results: the website, join, then back. */
export function resultsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url(t('kb.website_months'), 'https://rangecompound.com')
    .row()
    .text(t('kb.join'), 'menu:plans')
    .row()
    .text(t('kb.back'), 'menu:home');
}

/** Under Support: open membership, then back. */
export function supportKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.open_membership'), 'menu:status')
    .row()
    .text(t('kb.back'), 'menu:home');
}

export function backHome(): InlineKeyboard {
  return new InlineKeyboard().text(t('kb.back'), 'menu:home');
}
