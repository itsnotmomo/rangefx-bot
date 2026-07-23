import { type Bot } from 'grammy';
import { config, isAdmin, PLANS, type PlanKey } from '../config/index.js';
import { getLatestSubscription } from '../services/subscriptions.js';
import { recordEvent } from '../services/events.js';
import { safeSendMessage } from '../telegram/safe.js';
import { SUPPORT_ACK } from './content.js';
import { log } from '../util/logger.js';

/**
 * Real support relay. Any plain text a user sends the bot (private chat,
 * outside a command) is forwarded to every admin with enough context to answer:
 * name, username, telegram_user_id, and subscription status. Admins answer with
 *
 *     /reply <telegram_user_id> <message>
 *
 * which the bot DMs to the user, confirming delivery back to the admin. Both
 * directions land in `events` (support.inbound / support.outbound).
 */
export function registerSupport(bot: Bot): void {
  // ---- Admin -> user -------------------------------------------------------
  bot.command('reply', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) return;

    const raw = (ctx.match ?? '').toString().trim();
    const space = raw.indexOf(' ');
    const idPart = space === -1 ? raw : raw.slice(0, space);
    const message = space === -1 ? '' : raw.slice(space + 1).trim();

    if (!/^\d+$/.test(idPart) || !message) {
      await ctx.reply('Usage: /reply <telegram_user_id> <message>');
      return;
    }

    const target = BigInt(idPart);
    const result = await safeSendMessage(bot.api, target, message);
    if (result.ok) {
      await recordEvent({
        type: 'support.outbound',
        telegramUserId: target,
        payload: { admin: ctx.from.id, text: message },
      });
      await ctx.reply(`Delivered to ${idPart}.`);
    } else {
      await ctx.reply(
        result.blocked
          ? `Not delivered — ${idPart} has blocked the bot.`
          : `Not delivered to ${idPart} (${result.error}).`,
      );
    }
  });

  // ---- User -> admins ------------------------------------------------------
  // Registered after every command handler, so only non-command text lands here.
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const from = ctx.from;
    if (!from || from.is_bot) return;
    const text = ctx.message.text.trim();
    // Unknown "/commands" are typos, not support messages.
    if (!text || text.startsWith('/')) return;
    // Admins ARE the desk — nothing to relay.
    if (isAdmin(from.id)) return;

    const telegramUserId = BigInt(from.id);
    const sub = await getLatestSubscription(telegramUserId);
    const planLabel = sub?.plan ? PLANS[sub.plan as PlanKey]?.label ?? sub.plan : null;
    const statusLine = sub ? `${sub.status}${planLabel ? ` (${planLabel})` : ''}` : 'no subscription';

    const relay = [
      '📨 Support message',
      `From: ${from.first_name ?? '—'}${from.username ? ` (@${from.username})` : ''} · id ${from.id}`,
      `Subscription: ${statusLine}`,
      '',
      text,
      '',
      `Reply with: /reply ${from.id} <message>`,
    ].join('\n');

    let delivered = 0;
    for (const adminId of config.adminUserIds) {
      const res = await safeSendMessage(bot.api, adminId, relay);
      if (res.ok) delivered++;
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

    await ctx.reply(SUPPORT_ACK);
  });
}
