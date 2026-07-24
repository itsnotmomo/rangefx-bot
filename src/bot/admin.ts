import { type Bot, type Context } from 'grammy';
import { isAdmin, PLANS } from '../config/index.js';
import { countUsers, searchUsers } from '../services/users.js';
import { getLatestSubscription, activeCountsByPlan, subscriptionStatusCounts } from '../services/subscriptions.js';
import { acquisitionBreakdown, funnelCounts } from '../services/funnel.js';
import { formatAmount, getPrice } from '../stripe/prices.js';
import { type User } from '../db/schema.js';

/** Gate: only ADMIN_USER_IDS may run these. Silently ignore everyone else. */
function requireAdmin(ctx: Context): boolean {
  const uid = ctx.from?.id;
  return uid !== undefined && isAdmin(uid);
}

/** "12.5%" or an em-dash when the denominator is zero. */
function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The furthest funnel stage this user reached. */
function funnelStage(u: User): string {
  if (u.paidAt) return 'paid';
  if (u.openedCheckoutAt) return 'opened checkout';
  if (u.viewedPlansAt) return 'viewed plans';
  if (u.firstStartedAt) return 'started';
  return '—';
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
      'Range Compound — stats',
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

  bot.command('find', async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const query = (ctx.match ?? '').toString().trim();
    if (!query) {
      await ctx.reply('Usage: /find <username | telegram_id | name fragment>');
      return;
    }

    const found = await searchUsers(query);
    if (found.length === 0) {
      await ctx.reply(`No users match “${query}”.`);
      return;
    }

    const blocks: string[] = [];
    for (const u of found) {
      const sub = await getLatestSubscription(u.telegramUserId);
      const plan = sub?.plan ? PLANS[sub.plan as keyof typeof PLANS]?.label ?? sub.plan : '—';
      blocks.push(
        [
          `${u.firstName ?? '—'}${u.telegramUsername ? ` (@${u.telegramUsername})` : ''} · id ${u.telegramUserId}`,
          `  status: ${sub?.status ?? 'none'} · plan: ${plan}`,
          `  source: ${u.acquisitionSource ?? '—'} · joined: ${fmtDate(u.createdAt)} · funnel: ${funnelStage(u)}`,
        ].join('\n'),
      );
    }
    await ctx.reply(blocks.join('\n\n'));
  });
}
