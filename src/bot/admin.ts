import { type Bot, type Context } from 'grammy';
import { isAdmin } from '../config/index.js';
import { countUsers } from '../services/users.js';
import { subscriptionStatusCounts } from '../services/subscriptions.js';
import { broadcast, type BroadcastProgress } from './broadcast.js';
import { safeCall } from '../telegram/safe.js';
import { log } from '../util/logger.js';

/** Gate: only ADMIN_USER_IDS may run these. Silently ignore everyone else. */
function requireAdmin(ctx: Context): boolean {
  const uid = ctx.from?.id;
  return uid !== undefined && isAdmin(uid);
}

export function registerAdminCommands(bot: Bot): void {
  bot.command('stats', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const [users, statuses] = await Promise.all([countUsers(), subscriptionStatusCounts()]);
    const active = statuses.active ?? 0;
    const pastDue = statuses.past_due ?? 0;
    const canceled = statuses.canceled ?? 0;
    const totalSubs = Object.values(statuses).reduce((a, b) => a + b, 0);

    const lines = [
      '📊 Range Compound — stats',
      '',
      `Users (all sources): ${users}`,
      `Subscriptions total: ${totalSubs}`,
      `  • active:    ${active}`,
      `  • past_due:  ${pastDue}`,
      `  • canceled:  ${canceled}`,
    ];
    const other = Object.entries(statuses).filter(([s]) => !['active', 'past_due', 'canceled'].includes(s));
    for (const [status, n] of other) lines.push(`  • ${status}: ${n}`);

    await ctx.reply(lines.join('\n'));
  });

  bot.command('broadcast', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const text = (ctx.match ?? '').toString().trim();
    if (!text) {
      await ctx.reply('Usage: /broadcast <message>\n\nThe message is sent verbatim to every user.');
      return;
    }

    const statusMsg = await ctx.reply('Starting broadcast…');
    log.info('broadcast requested', { by: ctx.from?.id });

    let lastEdit = 0;
    const render = (p: BroadcastProgress) =>
      `Broadcasting…\nSent: ${p.sent} · Blocked: ${p.blocked} · Failed: ${p.failed} · Total: ${p.total}`;

    const final = await broadcast(bot.api, text, (p) => {
      // Throttle status-message edits so we don't hit Telegram's edit limits.
      const now = Date.now();
      if (now - lastEdit < 3000) return;
      lastEdit = now;
      void safeCall('editBroadcastStatus', () =>
        bot.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, render(p)),
      );
    });

    await safeCall('editBroadcastStatus', () =>
      bot.api.editMessageText(
        statusMsg.chat.id,
        statusMsg.message_id,
        [
          '✅ Broadcast complete.',
          `Sent: ${final.sent}`,
          `Blocked (bot blocked by user): ${final.blocked}`,
          `Failed (other errors): ${final.failed}`,
          `Total recipients: ${final.total}`,
        ].join('\n'),
      ),
    );
  });
}
