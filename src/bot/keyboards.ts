import { InlineKeyboard } from 'grammy';
import { PLANS } from '../config/index.js';

/** Main menu shown by /start. */
export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('View Plans', 'menu:plans')
    .text('My Subscription', 'menu:status')
    .row()
    .text('About', 'menu:about')
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

export function backHome(): InlineKeyboard {
  return new InlineKeyboard().text('« Back', 'menu:home');
}
