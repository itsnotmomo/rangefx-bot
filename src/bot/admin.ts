import { type Bot, type Context } from 'grammy';
import { isAdmin, PLANS } from '../config/index.js';
import { countUsers } from '../services/users.js';
import { activeCountsByPlan, subscriptionStatusCounts } from '../services/subscriptions.js';
import { acquisitionBreakdown, funnelCounts } from '../services/funnel.js';
import { formatAmount, getPrice } from '../stripe/prices.js';
import { broadcast, type BroadcastProgress } from './broadcast.js';
import { safeCall } from '../telegram/safe.js';
import { log } from '../util/logger.js';

/** "12.5%" or an em-dash when the denominator is zero. */
function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Revenue per plan: active subscriptions × the plan's Stripe price. */
async function revenueLines(activeByPlan: Record<string, number>): Promise<string[]> {
  const lines: string[] = [];
  for (const plan of Object.values(PLANS)) {
    const n = activeByPlan[plan.key] ?? 0;
    const price = await getPrice(plan.priceId);
    if (price && price.unit_amount != null) {
      const unit = price.unit_amount / 100;
      lines.push(
        `  • ${plan.label}: ${n} × ${formatAmount(unit, price.currency)} = ${formatAmount(n * unit, price.currency)} / ${plan.cadence.replace('billed ', '')}`,
      );
    } else {
      lines.push(`  • ${plan.label}: ${n} active (price unavailable)`);
    }
  }
  return lines;
}

/** Gate: only ADMIN_USER_IDS may run these. Silently ignore everyone else. */
function requireAdmin(ctx: Context): boolean {
  const uid = ctx.from?.id;
  return uid !== undefined && isAdmin(uid);
}

export function registerAdminCommands(bot: Bot): void {
  bot.command('stats', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const [users, statuses, funnel, sources, activeByPlan] = await Promise.all([
      countUsers(),
      subscriptionStatusCounts(),
      funnelCounts(),
      acquisitionBreakdown(),
      activeCountsByPlan(),
    ]);
    const active = statuses.active ?? 0;
    const pastDue = statuses.past_due ?? 0;
    const canceled = statuses.canceled ?? 0;
    const totalSubs = Object.values(statuses).reduce((a, b) => a + b, 0);

    const lines = [
      '📊 Range Compound — stats',
      '',
      `Users (all sources): ${users}`,
      '',
      'Funnel',
      `  started:          ${funnel.started}`,
      `  viewed plans:     ${funnel.viewedPlans} (${pct(funnel.viewedPlans, funnel.started)} of started)`,
      `  opened checkout:  ${funnel.openedCheckout} (${pct(funnel.openedCheckout, funnel.viewedPlans)} of viewed)`,
      `  paid:             ${funnel.paid} (${pct(funnel.paid, funnel.openedCheckout)} of checkout · ${pct(funnel.paid, funnel.started)} overall)`,
      '',
      'Subscriptions',
      `  total: ${totalSubs}`,
      `  • active:    ${active}`,
      `  • past_due:  ${pastDue}`,
      `  • canceled:  ${canceled}`,
    ];
    const other = Object.entries(statuses).filter(([s]) => !['active', 'past_due', 'canceled'].includes(s));
    for (const [status, n] of other) lines.push(`  • ${status}: ${n}`);

    lines.push('', 'Revenue (active × plan price)');
    lines.push(...(await revenueLines(activeByPlan)));

    lines.push('', 'Acquisition (users · paid · conversion)');
    for (const row of sources) {
      lines.push(`  • ${row.source ?? '(unset)'}: ${row.total} · ${row.paid} · ${pct(row.paid, row.total)}`);
    }

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
