import { Bot, type Context } from 'grammy';
import { config, PLANS, type PlanKey } from '../config/index.js';
import { upsertUser, getUser } from '../services/users.js';
import { createCheckoutSession } from '../stripe/checkout.js';
import { ABOUT, SUPPORT, WELCOME, plansText } from './content.js';
import { backHome, checkoutButton, mainMenu, plansKeyboard } from './keyboards.js';
import { renderStatus } from './status.js';
import { registerAdminCommands } from './admin.js';
import { safeCall } from '../telegram/safe.js';
import { log } from '../util/logger.js';

/** Persist/refresh the interacting user's identity on every touch. */
async function captureUser(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from || from.is_bot) return;
  await upsertUser({
    telegramUserId: BigInt(from.id),
    telegramUsername: from.username ?? null,
    firstName: from.first_name ?? null,
    source: 'bot',
  });
}

/** Replace the current message's text+keyboard, tolerating "not modified" edits. */
async function editView(ctx: Context, text: string, keyboard: Parameters<Context['editMessageText']>[1]): Promise<void> {
  const res = await safeCall('editMessageText', () => ctx.editMessageText(text, keyboard));
  if (!res.ok) {
    // If the message can't be edited (e.g. too old), fall back to a new message.
    await safeCall('reply', () => ctx.reply(text, keyboard));
  }
}

export function buildBot(): Bot {
  const bot = new Bot(config.botToken);

  // Global error boundary — a handler throwing must never take the process down.
  bot.catch((err) => {
    log.error('bot handler error', { error: err.error, update: err.ctx.update.update_id });
  });

  bot.command('start', async (ctx) => {
    await captureUser(ctx);
    await ctx.reply(WELCOME, { reply_markup: mainMenu() });
  });

  bot.command('status', async (ctx) => {
    await captureUser(ctx);
    const { text, keyboard } = await renderStatus(BigInt(ctx.from!.id));
    await ctx.reply(text, { reply_markup: keyboard });
  });

  bot.command('plans', async (ctx) => {
    await captureUser(ctx);
    await ctx.reply(plansText(), { reply_markup: plansKeyboard() });
  });

  bot.command('support', async (ctx) => {
    await captureUser(ctx);
    await ctx.reply(SUPPORT, { reply_markup: backHome() });
  });

  bot.command('about', async (ctx) => {
    await captureUser(ctx);
    await ctx.reply(ABOUT, { reply_markup: backHome() });
  });

  // Admin-only commands (/stats, /broadcast) — self-gated to ADMIN_USER_IDS.
  registerAdminCommands(bot);

  // ---- Inline menu navigation ----
  bot.callbackQuery('menu:home', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, WELCOME, { reply_markup: mainMenu() });
  });

  bot.callbackQuery('menu:plans', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, plansText(), { reply_markup: plansKeyboard() });
  });

  bot.callbackQuery('menu:about', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, ABOUT, { reply_markup: backHome() });
  });

  bot.callbackQuery('menu:support', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, SUPPORT, { reply_markup: backHome() });
  });

  bot.callbackQuery('menu:status', async (ctx) => {
    await ctx.answerCallbackQuery();
    await captureUser(ctx);
    const { text, keyboard } = await renderStatus(BigInt(ctx.from!.id));
    await editView(ctx, text, { reply_markup: keyboard });
  });

  // ---- Plan selection -> Stripe Checkout ----
  bot.callbackQuery(/^plan:(monthly|quarterly|annual)$/, async (ctx) => {
    const planKey = ctx.match![1] as PlanKey;
    await ctx.answerCallbackQuery();
    await captureUser(ctx);
    const telegramUserId = BigInt(ctx.from!.id);

    try {
      const user = await getUser(telegramUserId);
      const url = await createCheckoutSession(telegramUserId, planKey, user);
      await editView(
        ctx,
        [
          `${PLANS[planKey].label} — ${PLANS[planKey].cadence}.`,
          '',
          'Continue to Stripe to complete payment. Your group invite is delivered here automatically once payment succeeds.',
        ].join('\n'),
        { reply_markup: checkoutButton(url).row().text('« Back', 'menu:plans') },
      );
    } catch (err) {
      log.error('checkout session failed', { telegramUserId, planKey, error: err });
      await editView(ctx, 'Couldn’t start checkout just now. Please try again in a moment.', {
        reply_markup: backHome(),
      });
    }
  });

  return bot;
}
