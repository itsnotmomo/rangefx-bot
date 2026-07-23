import { InlineKeyboard } from 'grammy';
import { PLANS } from '../config/index.js';
import { FAQ_ITEMS } from './content.js';

/** Main menu shown by /start. */
export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Join the Desk', 'menu:plans')
    .row()
    .text('My Subscription', 'menu:status')
    .row()
    .text('Results', 'menu:results')
    .text('FAQ', 'menu:faq')
    .row()
    .text('Support', 'menu:support');
}

/** Plan picker. Callback data: plan:<key>. */
export function plansKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const plan of Object.values(PLANS)) {
    kb.text(`${plan.label} — ${plan.cadence}`, `plan:${plan.key}`).row();
  }
  kb.text('« Back', 'menu:home');
  return kb;
}

/** A single "Open checkout" URL button. */
export function checkoutButton(url: string): InlineKeyboard {
  return new InlineKeyboard().url('Open secure checkout', url);
}

/** A single "Manage billing" URL button. */
export function billingButton(url: string): InlineKeyboard {
  return new InlineKeyboard().url('Manage billing', url);
}

/** One button per FAQ question. Callback data: faq:<id>. */
export function faqKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const item of FAQ_ITEMS) {
    kb.text(item.question, `faq:${item.id}`).row();
  }
  kb.text('« Back', 'menu:home');
  return kb;
}

/** Under a FAQ answer: back to the question list or the menu. */
export function faqAnswerKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('« FAQ', 'menu:faq').text('« Menu', 'menu:home');
}

/** Under Results: the website plus back. */
export function resultsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url('rangecompound.com', 'https://rangecompound.com')
    .row()
    .text('« Back', 'menu:home');
}

export function backHome(): InlineKeyboard {
  return new InlineKeyboard().text('« Back', 'menu:home');
}
