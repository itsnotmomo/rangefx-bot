import { InlineKeyboard, type Api, type Bot, type Context } from 'grammy';
import { config, isAdmin } from '../config/index.js';
import {
  AUDIENCE_LABEL,
  audienceCount,
  audienceCounts,
  audienceIds,
  type AudienceKey,
} from '../services/audience.js';
import {
  createBroadcast,
  getBroadcast,
  interruptedBroadcasts,
  latestBroadcast,
  progressOf,
  runningBroadcasts,
  setStatus,
  snapshotAudience,
  type BroadcastContent,
} from '../services/broadcasts.js';
import { findSupportRoute } from '../services/support.js';
import {
  activeBroadcastId,
  broadcastConcurrency,
  broadcastRate,
  deliver,
  runBroadcast,
  summaryLines,
} from './broadcast.js';
import { type Broadcast } from '../db/schema.js';
import { safeCall, safeSendMessage } from '../telegram/safe.js';
import { log } from '../util/logger.js';

/**
 * Interactive broadcast: /broadcast → pick audience (live counts) → send the
 * content → preview → confirm → enqueue.
 *
 * Confirming does NOT send inside the webhook handler. It writes a broadcasts
 * row plus a frozen recipient snapshot, replies immediately, and starts the
 * runner detached. Awaiting the send here is what killed the process on Jul 27:
 * grammY rejects any update still running after timeoutMilliseconds (10s), and
 * Express 4 turns that rejection into a fatal unhandled rejection.
 *
 * Draft state stays in memory — losing an unconfirmed draft on restart is the
 * safe failure mode. Everything after confirmation is in the database.
 */

interface FlowState {
  step: 'content' | 'confirm';
  audience: AudienceKey;
  count: number;
  content?: BroadcastContent;
}

const flows = new Map<number, FlowState>();

const AUDIENCE_KEYS: AudienceKey[] = ['all', 'leads', 'churned', 'active'];

/** Gate: only ADMIN_USER_IDS. */
function requireAdmin(ctx: Context): boolean {
  const uid = ctx.from?.id;
  return uid !== undefined && isAdmin(uid);
}

/** Wall-clock estimate at the global rate, e.g. "7.6 min". */
function etaMinutes(recipients: number): string {
  const seconds = recipients / broadcastRate();
  return seconds < 90 ? `${Math.round(seconds)} sec` : `${(seconds / 60).toFixed(1)} min`;
}

/** DM every admin. Never throws — used from detached code paths. */
export async function notifyAdmins(api: Api, text: string): Promise<void> {
  for (const adminId of config.adminUserIds) {
    await safeSendMessage(api, adminId, text);
  }
}

/**
 * Run a broadcast detached from any webhook request, then report. Fully
 * guarded: this is deliberately not awaited by a handler, so anything escaping
 * it would become the exact unhandled rejection that caused the incident.
 */
function startDetached(api: Api, broadcast: Broadcast, statusChatId?: number, statusMessageId?: number): void {
  const report = async (): Promise<void> => {
    try {
      await runBroadcast(api, broadcast, (p) => {
        if (statusChatId === undefined || statusMessageId === undefined) return;
        void safeCall('editBroadcastStatus', () =>
          api.editMessageText(
            statusChatId,
            statusMessageId,
            `Broadcast #${broadcast.id} — sending…\n` +
              `${p.sent + p.failed}/${p.total} · Sent: ${p.sent} · Failed: ${p.failed}`,
          ),
        );
      });
    } catch (err) {
      log.error('broadcast run failed', { broadcastId: broadcast.id, error: err });
      await setStatus(broadcast.id, 'interrupted').catch(() => {});
    }
    try {
      const fresh = await getBroadcast(broadcast.id);
      if (fresh) await notifyAdmins(api, (await summaryLines(fresh)).join('\n'));
    } catch (err) {
      log.error('broadcast summary failed', { broadcastId: broadcast.id, error: err });
    }
  };
  void report().catch((err) => log.error('broadcast reporter failed', { broadcastId: broadcast.id, error: err }));
}

/**
 * On boot, any broadcast still marked 'running' was cut off mid-flight — the
 * runner only ever leaves that state by completing. Flag it and tell the
 * admins. Deliberately does NOT auto-resume: a restart loop would otherwise
 * re-send on every boot, and resuming is a decision with real-world cost.
 */
export async function reportInterruptedBroadcasts(api: Api): Promise<void> {
  const stale = await runningBroadcasts();
  for (const b of stale) {
    await setStatus(b.id, 'interrupted');
    const p = await progressOf(b.id);
    log.warn('interrupted broadcast detected', { broadcastId: b.id, ...p });
    await notifyAdmins(
      api,
      [
        `⚠️ Broadcast #${b.id} was interrupted.`,
        '',
        `Audience: ${b.audience} · ${b.kind}`,
        `Sent: ${p.sent} · Failed: ${p.failed} · Not yet attempted: ${p.pending}`,
        '',
        'It will NOT resume on its own. Recipients already sent to are recorded,',
        'so a resume skips them.',
        '',
        `/broadcast_resume ${b.id} — send to the ${p.pending} remaining`,
        `/broadcast_cancel ${b.id} — close it out and send nothing more`,
      ].join('\n'),
    );
  }
}

export function registerBroadcastFlow(bot: Bot): void {
  bot.command('broadcast', async (ctx, next) => {
    // Non-admins fall through to the unknown-command response.
    if (!requireAdmin(ctx)) return next();
    flows.delete(ctx.from!.id);

    const counts = await audienceCounts();
    const kb = new InlineKeyboard();
    for (const key of AUDIENCE_KEYS) {
      kb.text(`${AUDIENCE_LABEL[key]} (${counts[key]})`, `bcast:aud:${key}`).row();
    }
    kb.text('Cancel', 'bcast:cancel');
    await ctx.reply('Broadcast\n\nPick the audience. /cancel aborts at any step.', {
      reply_markup: kb,
    });
  });

  bot.command('cancel', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();
    const had = flows.delete(ctx.from!.id);
    await ctx.reply(had ? 'Broadcast cancelled.' : 'Nothing to cancel.');
  });

  // ---- Status of the most recent broadcast ----
  bot.command('broadcast_status', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();
    const arg = (ctx.match ?? '').toString().trim();
    const b = arg ? await getBroadcast(Number(arg)) : await latestBroadcast();
    if (!b) {
      await ctx.reply(arg ? `No broadcast #${arg}.` : 'No broadcast has ever run.');
      return;
    }
    const lines = await summaryLines(b);
    const running = activeBroadcastId();
    if (running === b.id) lines.push('', 'Currently running in this process.');
    else if (b.status === 'interrupted') lines.push('', `/broadcast_resume ${b.id} to continue.`);
    await ctx.reply(lines.join('\n'));
  });

  // ---- Explicit resume of an interrupted broadcast ----
  bot.command('broadcast_resume', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();
    const arg = (ctx.match ?? '').toString().trim();
    const b = arg ? await getBroadcast(Number(arg)) : (await interruptedBroadcasts())[0];
    if (!b) {
      await ctx.reply(
        arg ? `No broadcast #${arg}.` : 'No interrupted broadcast. /broadcast_status for the latest.',
      );
      return;
    }
    if (activeBroadcastId() !== null) {
      await ctx.reply(`Broadcast #${activeBroadcastId()} is already running. Wait for it to finish.`);
      return;
    }
    if (b.status === 'completed' || b.status === 'cancelled') {
      await ctx.reply(`Broadcast #${b.id} is ${b.status}. Nothing to resume.`);
      return;
    }
    const p = await progressOf(b.id);
    if (p.pending === 0) {
      await setStatus(b.id, 'completed', { finished: true });
      await ctx.reply(`Broadcast #${b.id} had nothing pending — marked complete.`);
      return;
    }
    log.info('broadcast resume requested', { broadcastId: b.id, by: ctx.from!.id, pending: p.pending });
    const status = await ctx.reply(
      `Resuming broadcast #${b.id} — ${p.pending} remaining (${p.sent} already sent, skipped).`,
    );
    startDetached(bot.api, b, status.chat.id, status.message_id);
  });

  // ---- Close out an interrupted broadcast without sending more ----
  bot.command('broadcast_cancel', async (ctx, next) => {
    if (!requireAdmin(ctx)) return next();
    const arg = (ctx.match ?? '').toString().trim();
    const b = arg ? await getBroadcast(Number(arg)) : (await interruptedBroadcasts())[0];
    if (!b) {
      await ctx.reply(arg ? `No broadcast #${arg}.` : 'No interrupted broadcast to cancel.');
      return;
    }
    if (activeBroadcastId() === b.id) {
      await ctx.reply(`Broadcast #${b.id} is running right now — cannot cancel mid-flight.`);
      return;
    }
    await setStatus(b.id, 'cancelled', { finished: true });
    await ctx.reply(`Broadcast #${b.id} cancelled. Nothing further will be sent.`);
  });

  bot.callbackQuery(/^bcast:aud:(all|leads|churned|active)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    const key = ctx.match![1] as AudienceKey;
    const count = await audienceCount(key);
    flows.set(ctx.from!.id, { step: 'content', audience: key, count });
    await safeCall('editMessageText', () =>
      ctx.editMessageText(
        [
          `Audience: ${AUDIENCE_LABEL[key]} — ${count} users.`,
          '',
          'Now send the message: text, or a photo with a caption.',
          '/cancel to abort.',
        ].join('\n'),
      ),
    );
  });

  bot.callbackQuery('bcast:cancel', async (ctx) => {
    if (!requireAdmin(ctx)) return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    flows.delete(ctx.from!.id);
    await safeCall('editMessageText', () => ctx.editMessageText('Broadcast cancelled.'));
  });

  bot.callbackQuery('bcast:send', async (ctx) => {
    if (!requireAdmin(ctx)) return void (await ctx.answerCallbackQuery());
    const state = flows.get(ctx.from!.id);
    if (!state || state.step !== 'confirm' || !state.content) {
      await ctx.answerCallbackQuery({ text: 'Nothing pending — start with /broadcast.' });
      return;
    }
    await ctx.answerCallbackQuery();
    await safeCall('editMessageReplyMarkup', () => ctx.editMessageReplyMarkup());

    if (activeBroadcastId() !== null) {
      flows.delete(ctx.from!.id);
      await ctx.reply(`Broadcast #${activeBroadcastId()} is already running. Wait for it to finish.`);
      return;
    }

    // Durable idempotency. Telegram repeats the update_id verbatim when it
    // retries an unacknowledged webhook, and the unique index on
    // idempotency_key rejects the second insert. In-memory flow state cannot
    // guarantee this: it is empty after a restart, which is exactly when a
    // retry arrives.
    const idempotencyKey = `cbq:${ctx.update.update_id}`;
    const { broadcast, created } = await createBroadcast({
      audience: state.audience,
      content: state.content,
      createdBy: BigInt(ctx.from!.id),
      idempotencyKey,
    });
    flows.delete(ctx.from!.id);

    if (!created) {
      log.warn('duplicate broadcast confirmation ignored', { broadcastId: broadcast.id, idempotencyKey });
      await ctx.reply(`That confirmation was already processed as broadcast #${broadcast.id}.`);
      return;
    }

    log.info('broadcast confirmed', {
      broadcastId: broadcast.id,
      by: ctx.from!.id,
      audience: state.audience,
    });

    // Freeze the recipient set now. Resume reads this snapshot, never the
    // audience query — the runner marks users blocked as it goes, and every
    // audience predicate excludes blocked users.
    const ids = await audienceIds(state.audience);
    await snapshotAudience(broadcast.id, ids);

    const status = await ctx.reply(
      [
        `Broadcast #${broadcast.id} queued.`,
        `Audience: ${AUDIENCE_LABEL[state.audience]} — ${ids.length} recipients.`,
        `Rate: ${broadcastRate()}/sec across ${broadcastConcurrency()} workers.`,
        `Estimated: ~${etaMinutes(ids.length)}.`,
        '',
        `/broadcast_status ${broadcast.id} for progress.`,
      ].join('\n'),
    );

    // Detached on purpose: this handler must return in milliseconds.
    startDetached(bot.api, broadcast, status.chat.id, status.message_id);
  });

  // Content capture: the admin's next message while a flow awaits content.
  bot.on('message', async (ctx, next) => {
    const from = ctx.from;
    if (!from || !isAdmin(from.id) || ctx.chat.type !== 'private') return next();
    const state = flows.get(from.id);
    if (!state || state.step !== 'content') return next();

    const replyTo = ctx.message.reply_to_message;
    if (replyTo && (await findSupportRoute(ctx.chat.id, replyTo.message_id)) !== null) {
      return next(); // support routing takes precedence
    }

    let content: BroadcastContent | null = null;
    const photo = ctx.message.photo;
    if (photo && photo.length > 0) {
      content = {
        photoFileId: photo[photo.length - 1]!.file_id,
        caption: ctx.message.caption,
        entities: ctx.message.caption_entities,
      };
    } else if (ctx.message.text) {
      if (ctx.message.text.startsWith('/')) {
        await ctx.reply('That looks like a command. Send the message content, or /cancel.');
        return;
      }
      content = { text: ctx.message.text, entities: ctx.message.entities };
    }

    if (!content) {
      await ctx.reply('Text, or a photo with a caption — nothing else broadcasts. Try again, or /cancel.');
      return;
    }

    state.content = content;
    state.step = 'confirm';

    // Same send path as the runner, so the preview matches what members get.
    const preview = await deliver(ctx.api, ctx.chat.id, content);
    if (!preview.ok) {
      state.step = 'content';
      state.content = undefined;
      await ctx.reply(`Telegram rejected the preview (${preview.error}). Send the message again, or /cancel.`);
      return;
    }
    await ctx.reply(
      `That's the preview above. Send to ${state.count} users at ${broadcastRate()}/sec (~${etaMinutes(state.count)})?`,
      { reply_markup: new InlineKeyboard().text('Send', 'bcast:send').text('Cancel', 'bcast:cancel') },
    );
  });
}
