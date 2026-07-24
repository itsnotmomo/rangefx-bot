import { InlineKeyboard } from 'grammy';
import { PLANS } from '../config/index.js';
import { FAQ_ITEMS, t } from './content.js';

/**
 * Layout rules: main menu leads with the one action that matters (join),
 * full width. Every sub-menu puts action buttons first and «Back last, full
 * width.
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

/** Plan picker. Callback data: plan:<key>. */
export function plansKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const plan of Object.values(PLANS)) {
    kb.text(`${plan.label} — ${plan.cadence}`, `plan:${plan.key}`).row();
  }
  kb.text(t('kb.back'), 'menu:home');
  return kb;
}

/** A single "Open secure checkout" URL button. */
export function checkoutButton(url: string): InlineKeyboard {
  return new InlineKeyboard().url(t('kb.checkout'), url);
}

/** A single "Manage billing" URL button. */
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

/** Under a FAQ answer: back to the question list, then «Back. */
export function faqAnswerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t('kb.more_questions'), 'menu:faq')
    .row()
    .text(t('kb.back'), 'menu:home');
}

/** Under Results: the website, then «Back. */
export function resultsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url(t('kb.website'), 'https://rangecompound.com')
    .row()
    .text(t('kb.back'), 'menu:home');
}

export function backHome(): InlineKeyboard {
  return new InlineKeyboard().text(t('kb.back'), 'menu:home');
}
