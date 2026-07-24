import { type Bot } from 'grammy';
import { config, isAdmin, PLANS, type PlanKey } from '../config/index.js';
import { getLatestSubscription } from '../services/subscriptions.js';
import { recordEvent } from '../services/events.js';
import { findSupportRoute, saveSupportRoute } from '../services/support.js';
import { safeCall, safeSendMessage } from '../telegram/safe.js';
import { t } from './content.js';
import { mainMenu } from './keyboards.js';
import { log } from '../util/logger.js';

/**
 * Real support relay, both directions.
 *
 * User -> admins: any plain text a user sends the bot (private chat, outside a
 * command) is forwarded to every admin with name, username, telegram_user_id,
 * and subscription status. Each forwarded message is recorded in
 * support_routes so it can be answered by reply.
 *
 * Admins -> user, two ways:
 *   • Native Telegram reply to a forwarded message — routed automatically.
 *     Feels like texting, not command-line.
 *   • /reply <telegram_user_id> <message> — explicit fallback.
 * Delivery is confirmed to the admin; both directions land in `events`.
 */
export function registerSupport(bot: Bot): void {
  // ---- /reply fallback -------------------------------------------------------
  bot.command('reply', async (ctx, next) => {
    // Non-admins fall through to the unknown-command response below.
    if (!ctx.from || !isAdmin(ctx.from.id)) return next();

    const raw = (ctx.match ?? '').toString().trim();
    const space = raw.indexOf(' ');
    const idPart = space === -1 ? raw : raw.slice(0, space);
    const message = space === -1 ? '' : raw.slice(space + 1).trim();

    if (!/^\d+$/.test(idPart) || !message) {
      await ctx.reply(
        'Usage: /reply <telegram_user_id> <message>\nTip: replying directly to a forwarded support message also works.',
      );
      return;
    }

    await deliverReply(bot, ctx.from.id, BigInt(idPart), message, async (text) => {
      await ctx.reply(text);
    });
  });

  // ---- Native reply routing (admin replies to a forwarded support message) ----
  bot.on('message:text', async (ctx, next) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id) || ctx.chat.type !== 'private') return next();
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo) return next();

    const target = await findSupportRoute(ctx.chat.id, replyTo.message_id);
    if (target === null) return next();

    await deliverReply(bot, from.id, target, ctx.message.text, async (text) => {
      await ctx.reply(text, { reply_parameters: { message_id: ctx.message.message_id } });
    });
  });

  // ---- User -> admins ----------------------------------------------------------
  // Registered after every command handler, so only non-command text (or an
  // unrecognized command) lands here.
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const from = ctx.from;
    if (!from || from.is_bot) return;
    const text = ctx.message.text.trim();
    if (!text) return;
    // Admins ARE the desk — their plain text is not a support ticket.
    if (isAdmin(from.id)) return;
    // Unrecognized "/commands" get a helpful response, never silence.
    if (text.startsWith('/')) {
      await ctx.reply(t('error.unknown_command'), { reply_markup: mainMenu() });
      return;
    }

    const telegramUserId = BigInt(from.id);
    const sub = await getLatestSubscription(telegramUserId);
    const planLabel = sub?.plan ? PLANS[sub.plan as PlanKey]?.label ?? sub.plan : null;
    const statusLine = sub ? `${sub.status}${planLabel ? ` (${planLabel})` : ''}` : 'no subscription';

    const relay = [
      'Support message',
      `From: ${from.first_name ?? '—'}${from.username ? ` (@${from.username})` : ''} · id ${from.id}`,
      `Subscription: ${statusLine}`,
      '',
      text,
      '',
      `Reply to this message to answer, or /reply ${from.id} <message>.`,
    ].join('\n');

    let delivered = 0;
    for (const adminId of config.adminUserIds) {
      const res = await safeCall('sendMessage', () => bot.api.sendMessage(Number(adminId), relay));
      if (res.ok) {
        delivered++;
        await saveSupportRoute(adminId, res.value.message_id, telegramUserId);
      }
    }

    await recordEvent({
      type: 'support.inbound',
      telegramUserId,
      payload: { text, deliveredToAdmins: delivered },
    });
    log.info('support message relayed', {
      telegramUserId,
      deliveredToAdmins: delivered,
      admins: config.adminUserIds.length,
    });

    await ctx.reply(t('support.ack'));
  });
}

/** DM an admin's answer to the user, confirm to the admin, log the event. */
async function deliverReply(
  bot: Bot,
  adminId: number,
  target: bigint,
  message: string,
  confirm: (text: string) => Promise<void>,
): Promise<void> {
  const result = await safeSendMessage(bot.api, target, message);
  if (result.ok) {
    await recordEvent({
      type: 'support.outbound',
      telegramUserId: target,
      payload: { admin: adminId, text: message },
    });
    await confirm(`Delivered to ${target}.`);
  } else {
    await confirm(
      result.blocked
        ? `Not delivered — ${target} has blocked the bot.`
        : `Not delivered to ${target} (${result.error}).`,
    );
  }
}
