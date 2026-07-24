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
import { FAQ_ITEMS, checkoutMessage, plansText, t } from './content.js';
import {
  checkoutErrorKeyboard,
  checkoutKeyboard,
  faqAnswerKeyboard,
  faqKeyboard,
  freshInviteKeyboard,
  inviteErrorKeyboard,
  mainMenu,
  noAccessKeyboard,
  paymentReturnKeyboard,
  plansKeyboard,
  resultsKeyboard,
  supportKeyboard,
} from './keyboards.js';
import { renderStatus } from './status.js';
import { registerAdminCommands } from './admin.js';
import { registerBroadcastFlow } from './broadcast-flow.js';
import { registerSupport } from './support.js';
import { notifyStart } from './notifications.js';
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
    // True exactly once, ever: the atomic null -> set transition on
    // first_started_at. Legacy imports (row exists, never started) count as new.
    const firstStart = await markStarted(BigInt(ctx.from!.id));

    // The user's welcome always comes first. An abandoned checkout return
    // ('cancelled') shows the normal welcome — no special message.
    if (payload === 'paid') {
      await ctx.reply(t('payment.return'), { reply_markup: paymentReturnKeyboard() });
    } else {
      await ctx.reply(t('welcome'), { reply_markup: mainMenu() });
    }

    // ...then admins are notified fire-and-forget. Checkout returns are not
    // engagement events and never notify.
    if (!isCheckoutReturn) {
      const from = ctx.from!;
      void notifyStart(
        bot.api,
        {
          telegramUserId: BigInt(from.id),
          firstName: from.first_name ?? null,
          lastName: from.last_name ?? null,
          username: from.username ?? null,
        },
        firstStart ? 'new' : 'returning',
      ).catch((err) => log.error('start notification failed', { error: err }));
    }
  });

  bot.command('status', async (ctx) => {
    await captureUser(ctx);
    const { text, keyboard } = await renderStatus(BigInt(ctx.from!.id));
    await ctx.reply(text, { reply_markup: keyboard });
  });

  bot.command('plans', async (ctx) => {
    await captureUser(ctx);
    await touchPlansFunnel(BigInt(ctx.from!.id));
    await ctx.reply(plansText(), { reply_markup: await plansKeyboard() });
  });

  bot.command('faq', async (ctx) => {
    await captureUser(ctx);
    await ctx.reply(t('faq.intro'), { reply_markup: faqKeyboard() });
  });

  bot.command('results', async (ctx) => {
    await captureUser(ctx);
    await ctx.reply(t('results'), { reply_markup: resultsKeyboard() });
  });

  bot.command('support', async (ctx) => {
    await captureUser(ctx);
    await ctx.reply(t('support'), { reply_markup: supportKeyboard() });
  });

  // Admin-only commands (/stats, /find) — self-gated to ADMIN_USER_IDS;
  // non-admins fall through to the unknown-command response.
  registerAdminCommands(bot);

  // Interactive /broadcast (+ /cancel). Its content-capture message handler
  // passes through everything that isn't an awaited broadcast draft.
  registerBroadcastFlow(bot);

  // ---- Inline menu navigation ----
  bot.callbackQuery('menu:home', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, t('welcome'), { reply_markup: mainMenu() });
  });

  bot.callbackQuery('menu:plans', async (ctx) => {
    await ctx.answerCallbackQuery();
    await captureUser(ctx);
    await touchPlansFunnel(BigInt(ctx.from!.id));
    await editView(ctx, plansText(), { reply_markup: await plansKeyboard() });
  });

  bot.callbackQuery('menu:results', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, t('results'), { reply_markup: resultsKeyboard() });
  });

  bot.callbackQuery('menu:faq', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, t('faq.intro'), { reply_markup: faqKeyboard() });
  });

  bot.callbackQuery(/^faq:([a-z]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const item = FAQ_ITEMS.find((f) => f.id === ctx.match![1]);
    if (!item) {
      await editView(ctx, t('faq.intro'), { reply_markup: faqKeyboard() });
      return;
    }
    await editView(ctx, `${item.question}\n\n${item.answer}`, { reply_markup: faqAnswerKeyboard() });
  });

  bot.callbackQuery('menu:support', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editView(ctx, t('support'), { reply_markup: supportKeyboard() });
  });

  bot.callbackQuery('menu:status', async (ctx) => {
    await ctx.answerCallbackQuery();
    await captureUser(ctx);
    const { text, keyboard } = await renderStatus(BigInt(ctx.from!.id));
    await editView(ctx, text, { reply_markup: keyboard });
  });

  // ---- New group link for an active member ----
  bot.callbackQuery('invite:fresh', async (ctx) => {
    await ctx.answerCallbackQuery();
    const telegramUserId = BigInt(ctx.from!.id);
    if (!(await hasLiveGroupGrant(telegramUserId))) {
      await editView(ctx, t('error.no_access'), { reply_markup: await noAccessKeyboard() });
      return;
    }
    const link = await mintInviteLink(bot.api, telegramUserId, 'reissue');
    if (!link) {
      await editView(ctx, t('error.invite'), { reply_markup: inviteErrorKeyboard() });
      return;
    }
    await recordEvent({ type: 'access.invite_reissued', telegramUserId });
    await ctx.reply(t('invite.fresh', { hours: config.inviteExpiryHours }), {
      reply_markup: freshInviteKeyboard(link),
    });
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
        checkoutMessage(plan.label, price, plan.cadence, config.inviteExpiryHours),
        { reply_markup: checkoutKeyboard(url) },
      );
    } catch (err) {
      log.error('checkout session failed', { telegramUserId, planKey, error: err });
      await editView(ctx, t('error.checkout'), { reply_markup: checkoutErrorKeyboard(planKey) });
    }
  });

  // Support relay LAST: native-reply routing, /reply, the plain-text inbox,
  // and the unknown-command response. Registering the message handlers after
  // every command means only non-command text (or unknown commands) reaches
  // them.
  registerSupport(bot);

  return bot;
}
