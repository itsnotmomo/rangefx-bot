import { Bot, type Context } from 'grammy';
import { config, PLANS, type PlanKey } from '../config/index.js';
import { upsertUser, getUser } from '../services/users.js';
import {
  markOpenedCheckout,
  markStarted,
  markViewedPlans,
  scheduleFollowups,
} from '../services/funnel.js';
import { recordEvent } from '../services/events.js';
import { createCheckoutSession } from '../stripe/checkout.js';
import { priceDisplay } from '../stripe/prices.js';
import {
  CHECKOUT_MESSAGE,
  FAQ_INTRO,
  FAQ_ITEMS,
  FRESH_INVITE,
  PAYMENT_RETURN,
  RESULTS,
  SUPPORT,
  WELCOME,
  plansText,
} from './content.js';
import {
  backHome,
  checkoutButton,
  faqAnswerKeyboard,
  faqKeyboard,
  mainMenu,
  plansKeyboard,
  resultsKeyboard,
} from './keyboards.js';
import { renderStatus } from './status.js';
import { registerAdminCommands } from './admin.js';
import { registerSupport } from './support.js';
import { hasLiveGroupGrant, mintInviteLink } from '../access/grants.js';
import { safeCall } from '../telegram/safe.js';
import { log } from '../util/logger.js';

/** Persist/refresh the interacting user's identity on every touch. */
async function captureUser(ctx: Context, acquisitionSource?: string): Promise<void> {
  const from = ctx.from;
  if (!from || from.is_bot) return;
  await upsertUser({
    telegramUserId: BigInt(from.id),
    telegramUsername: from.username ?? null,
    firstName: from.first_name ?? null,
    source: 'bot',
    acquisitionSource: acquisitionSource ?? null,
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

/** Funnel touch: user is looking at plans — mark it and arm the follow-ups. */
async function touchPlansFunnel(telegramUserId: bigint): Promise<void> {
  await markViewedPlans(telegramUserId);
  await scheduleFollowups(telegramUserId);
}

export function buildBot(): Bot {
  const bot = new Bot(config.botToken);

  // Global error boundary — a handler throwing must never take the process down.
  bot.catch((err) => {
    log.error('bot handler error', { error: err.error, update: err.ctx.update.update_id });
  });

  bot.command('start', async (ctx) => {
    const payload = (ctx.match ?? '').toString().trim();
    // 'paid'/'cancelled' are Stripe return deep links, not acquisition sources.
    const isCheckoutReturn = payload === 'paid' || payload === 'cancelled';
    const source = !payload || isCheckoutReturn ? 'direct' : payload.slice(0, 64);

    await captureUser(ctx, source);
    await markStarted(BigInt(ctx.from!.id));

    if (payload === 'paid') {
      await ctx.reply(PAYMENT_RETURN, { reply_markup: mainMenu() });
      return;
    }
    await ctx.reply(WELCOME, { reply_markup: mainMenu() });
  });

  bot.command('status', async (ctx) => {
    await captureUser(ctx);
    const { text, keyboard } = await renderStatus(BigInt(ctx.from!.id));
    await ctx.reply(text, { reply_markup: keyboard });
  });

  bot.command('plans', async (ctx) => {
    await captureUser(ctx);
    await touchPlansFunnel(BigInt(ctx.from!.id));
    await ctx.reply(plansText(), { reply_markup: plansKeyboard() });
  });

  bot.command('support', async (ctx) => {
    await captureUser(ctx);
    await ctx.reply(SUPPORT, { reply_markup: backHome() });
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
    await captureUser(ctx);
    await touchPlansFunnel(BigInt(ctx.from!.id));
    await editView(ctx, plansText(), { reply_markup: plansKeyboard() });
  });

  bot.callbackQuery('menu:results', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, RESULTS, { reply_markup: resultsKeyboard() });
  });

  bot.callbackQuery('menu:faq', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, FAQ_INTRO, { reply_markup: faqKeyboard() });
  });

  bot.callbackQuery(/^faq:([a-z]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const item = FAQ_ITEMS.find((f) => f.id === ctx.match![1]);
    if (!item) {
      await editView(ctx, FAQ_INTRO, { reply_markup: faqKeyboard() });
      return;
    }
    await editView(ctx, `${item.question}\n\n${item.answer}`, { reply_markup: faqAnswerKeyboard() });
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

  // ---- Fresh invite for an already-authorised member ----
  bot.callbackQuery('invite:fresh', async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramUserId = BigInt(ctx.from!.id);
    if (!(await hasLiveGroupGrant(telegramUserId))) {
      await editView(ctx, 'Your access isn’t active. Pick a plan to join the desk.', {
        reply_markup: plansKeyboard(),
      });
      return;
    }
    const link = await mintInviteLink(bot.api, telegramUserId, 'reissue');
    if (!link) {
      await editView(ctx, 'Couldn’t create an invite just now. Try again in a moment.', {
        reply_markup: backHome(),
      });
      return;
    }
    await recordEvent({ type: 'access.invite_reissued', telegramUserId });
    await ctx.reply(FRESH_INVITE(link, config.inviteExpiryHours));
  });

  // ---- Plan selection -> Stripe Checkout ----
  bot.callbackQuery(/^plan:(monthly|quarterly|annual)$/, async (ctx) => {
    const planKey = ctx.match![1] as PlanKey;
    await ctx.answerCallbackQuery();
    await captureUser(ctx);
    const telegramUserId = BigInt(ctx.from!.id);
    await markOpenedCheckout(telegramUserId);
    await scheduleFollowups(telegramUserId);

    try {
      const user = await getUser(telegramUserId);
      const plan = PLANS[planKey];
      const [url, price] = await Promise.all([
        createCheckoutSession(telegramUserId, planKey, user),
        priceDisplay(plan.priceId),
      ]);
      await editView(
        ctx,
        CHECKOUT_MESSAGE(plan.label, price, plan.cadence, config.inviteExpiryHours),
        { reply_markup: checkoutButton(url).row().text('« Back', 'menu:plans') },
      );
    } catch (err) {
      log.error('checkout session failed', { telegramUserId, planKey, error: err });
      await editView(ctx, 'Couldn’t start checkout just now. Please try again in a moment.', {
        reply_markup: backHome(),
      });
    }
  });

  // Support relay LAST: /reply plus the plain-text inbox. Registering the
  // message:text handler after every command means only non-command text
  // reaches it.
  registerSupport(bot);

  return bot;
}
