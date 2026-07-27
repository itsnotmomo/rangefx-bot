import { type Bot, type Context } from 'grammy';
import { isAdmin } from '../config/index.js';
import { log } from '../util/logger.js';
import {
  cadence,
  DESK_TZ,
  effectivePollIntervalSeconds,
  newsChatId,
  newsConfig,
  newsConfigured,
  newsTopicId,
} from './config.js';
import { bothTimes } from './format.js';
import { activeProvider, mockProvider } from './providers/index.js';
import { providerUsage, setPaused, statusSnapshot, upsertOneEvent } from './repo.js';
import { quotaState } from './quota.js';
import { runImport } from './jobs.js';

/**
 * Admin tooling for the news module.
 *
 * Uses the existing isAdmin() check and the same fall-through convention as
 * src/bot/admin.ts: a non-admin gets next(), so these commands are invisible
 * rather than forbidden.
 */

function requireAdmin(ctx: Context): boolean {
  const uid = ctx.from?.id;
  return uid !== undefined && isAdmin(uid);
}

/** "Mon 28 Jul, 21:30 Makassar · 14:30 London" — always derived from stored UTC. */
function fullTime(at: Date): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: DESK_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(at);
  return `${day}, ${bothTimes(at)}`;
}

function ago(at: Date | null): string {
  if (!at) return 'never';
  const minutes = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function registerNewsCommands(bot: Bot): void {
  // ---- Status -------------------------------------------------------------
  bot.command('news_status', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();

    const provider = activeProvider();
    const [snapshot, usage, quota] = await Promise.all([
      statusSnapshot(),
      providerUsage(provider.name),
      quotaState(provider.name),
    ]);

    const lines = [
      'Range Compound — news module',
      '',
      `State:      ${newsConfigured() ? (snapshot.paused ? 'configured, PAUSED' : 'live') : 'dormant (NEWS_ENABLED off or NEWS_CHAT_ID unset)'}`,
      `Provider:   ${provider.name} (NEWS_PROVIDER=${newsConfig.provider})`,
      `Chat:       ${newsChatId() ?? '—'}${newsTopicId() !== undefined ? ` · topic ${newsTopicId()}` : ' · no topic set'}`,
      `Filter:     ${snapshot.currencies} · min impact ${snapshot.minImpact}`,
      `Quiet:      ${newsConfig.quietStart && newsConfig.quietEnd ? `${newsConfig.quietStart}–${newsConfig.quietEnd} ${DESK_TZ}` : 'not set'}`,
      '',
      'Cadence',
      `  import:     every ${cadence.importIntervalMinutes}m`,
      `  reminder:   every 1m (T-5 window)`,
      `  release:    every 1m`,
      `  result:     every ${effectivePollIntervalSeconds(provider.name)}s, ${cadence.pollWindowMinutes}m after release${
        effectivePollIntervalSeconds(provider.name) !== cadence.pollIntervalSeconds
          ? ` (floored from ${cadence.pollIntervalSeconds}s for ${provider.name})`
          : ''
      }`,
      '',
      'Import',
      `  last run:   ${ago(snapshot.lastImportAt)}${snapshot.lastImportAt ? ` (${fullTime(snapshot.lastImportAt)})` : ''}`,
      `  stored:     ${snapshot.totalEvents} events · ${snapshot.upcomingCount} upcoming`,
      `  awaiting result: ${snapshot.awaitingResult}`,
      '',
      `Provider requests (${provider.name})`,
      `  last 24h:      ${usage.last24h}`,
      `  rolling 30d:   ${usage.rolling30d}`,
      `  month to date: ${usage.monthToDate}${quota.cap > 0 ? ` / ${quota.cap} cap` : ' (no cap set)'}`,
      `  remaining:     ${quota.cap > 0 ? `${quota.remaining}${quota.exceeded ? '  ← CAP REACHED, calls blocked' : ''}` : 'unlimited'}`,
      `  failed (30d):  ${usage.failures30d}`,
    ];

    if (snapshot.upcoming.length > 0) {
      lines.push('', 'Next up');
      for (const e of snapshot.upcoming) {
        lines.push(`  • ${e.currency} ${e.title}`);
        lines.push(`    ${fullTime(e.releaseAt)}`);
      }
    } else {
      lines.push('', 'Next up: nothing scheduled.');
    }

    await ctx.reply(lines.join('\n'));
  });

  // ---- Topic discovery ----------------------------------------------------
  // Run this inside the target topic to capture the two ids for the env.
  bot.command('news_here', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();
    const threadId = ctx.message?.message_thread_id;
    const lines = [
      'This chat:',
      '',
      `NEWS_CHAT_ID=${ctx.chat.id}`,
      threadId !== undefined ? `NEWS_TOPIC_ID=${threadId}` : 'NEWS_TOPIC_ID=   (not a forum topic — leave unset)',
      '',
      `type: ${ctx.chat.type}`,
    ];
    await ctx.reply(lines.join('\n'), { message_thread_id: threadId });
  });

  // ---- Pause / resume -----------------------------------------------------
  bot.command('news_pause', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();
    await setPaused(true);
    log.info('news module paused', { by: ctx.from?.id });
    await ctx.reply('News paused. Imports continue so the calendar stays current; nothing will post.');
  });

  bot.command('news_resume', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();
    await setPaused(false);
    log.info('news module resumed', { by: ctx.from?.id });
    await ctx.reply('News resumed. Reminders, releases and results will post again.');
  });

  // ---- Full-cycle rehearsal ----------------------------------------------
  bot.command('news_test', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();

    const raw = (ctx.match ?? '').toString().trim();
    // 7 minutes clears the T-5 window with room to spare, so the default
    // rehearsal exercises all three messages.
    const minutes = raw ? Number.parseInt(raw, 10) : 7;
    if (Number.isNaN(minutes) || minutes < 1 || minutes > 720) {
      await ctx.reply('Usage: /news_test <minutes>  (1–720, default 7)');
      return;
    }

    const event = mockProvider.schedule(minutes);
    const row = await upsertOneEvent(mockProvider.name, event);

    const stages = [
      minutes > 6
        ? `  • T-5 notice at ${bothTimes(new Date(event.releaseAt.getTime() - 5 * 60_000))}`
        : '  • T-5 notice SKIPPED — needs more than 6 minutes lead time',
      `  • release post at ${bothTimes(event.releaseAt)}`,
      `  • result edit ~15s later (polled every ${cadence.pollIntervalSeconds}s)`,
    ];

    const warning = newsConfigured()
      ? ''
      : '\n\nNote: the module is dormant (NEWS_ENABLED off or NEWS_CHAT_ID unset), so this event is stored but nothing will post.';

    await ctx.reply(
      [
        `Test event scheduled — ${event.currency} ${event.title}`,
        `id ${row.id} · provider mock · releases in ${minutes}m`,
        `${fullTime(event.releaseAt)}`,
        '',
        'Expected sequence:',
        ...stages,
      ].join('\n') + warning,
    );
  });

  // ---- Manual import ------------------------------------------------------
  // Not in the spec, but the alternative when debugging is waiting out the
  // import interval, which at the default of 6 hours is not a debugging loop.
  bot.command('news_import', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();
    if (!newsConfigured()) {
      await ctx.reply('News module is dormant — set NEWS_ENABLED and NEWS_CHAT_ID first.');
      return;
    }
    await ctx.reply('Importing…');
    try {
      await runImport(ctx.api);
      const snapshot = await statusSnapshot();
      await ctx.reply(`Import complete. ${snapshot.totalEvents} events stored · ${snapshot.upcomingCount} upcoming.`);
    } catch (err) {
      log.error('manual news import failed', { error: err });
      await ctx.reply('Import failed — check the logs.');
    }
  });
}
