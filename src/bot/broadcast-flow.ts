import { InlineKeyboard, type Bot } from 'grammy';
import { isAdmin } from '../config/index.js';
import {
  AUDIENCE_LABEL,
  audienceCount,
  audienceCounts,
  audienceIds,
  type AudienceKey,
} from '../services/audience.js';
import { findSupportRoute } from '../services/support.js';
import { broadcastTo, type BroadcastContent } from './broadcast.js';
import { safeCall } from '../telegram/safe.js';
import { log } from '../util/logger.js';

/**
 * Interactive broadcast: /broadcast → pick audience (live counts) → send the
 * content (text, or photo+caption) → preview exactly as users will see it →
 * confirm → throttled send with progress + final report. /cancel aborts at any
 * step. State is per-admin and in-memory: a restart simply drops an unfinished
 * draft, which is the safe failure mode for a mass-send tool.
 */

interface FlowState {
  step: 'content' | 'confirm';
  audience: AudienceKey;
  count: number;
  content?: BroadcastContent;
}

const flows = new Map<number, FlowState>();

const AUDIENCE_KEYS: AudienceKey[] = ['all', 'leads', 'churned', 'active'];

export function registerBroadcastFlow(bot: Bot): void {
  bot.command('broadcast', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) return;
    flows.delete(ctx.from.id);

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

  bot.command('cancel', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) return;
    const had = flows.delete(ctx.from.id);
    await ctx.reply(had ? 'Broadcast cancelled.' : 'Nothing to cancel.');
  });

  bot.callbackQuery(/^bcast:aud:(all|leads|churned|active)$/, async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    const key = ctx.match![1] as AudienceKey;
    const count = await audienceCount(key);
    flows.set(ctx.from.id, { step: 'content', audience: key, count });
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
    if (!ctx.from || !isAdmin(ctx.from.id)) return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery();
    flows.delete(ctx.from.id);
    await safeCall('editMessageText', () => ctx.editMessageText('Broadcast cancelled.'));
  });

  bot.callbackQuery('bcast:send', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) return void (await ctx.answerCallbackQuery());
    const state = flows.get(ctx.from.id);
    if (!state || state.step !== 'confirm' || !state.content) {
      await ctx.answerCallbackQuery({ text: 'Nothing pending — start with /broadcast.' });
      return;
    }
    await ctx.answerCallbackQuery();
    flows.delete(ctx.from.id);
    await safeCall('editMessageReplyMarkup', () => ctx.editMessageReplyMarkup());

    log.info('broadcast confirmed', { by: ctx.from.id, audience: state.audience });
    const ids = await audienceIds(state.audience);
    const status = await ctx.reply(`Sending to ${ids.length} users…`);

    const final = await broadcastTo(bot.api, ids, state.content, (p) => {
      const processed = p.sent + p.failed + p.blocked;
      void safeCall('editBroadcastStatus', () =>
        bot.api.editMessageText(
          status.chat.id,
          status.message_id,
          `Sending… ${processed}/${p.total}\nSent: ${p.sent} · Blocked: ${p.blocked} · Failed: ${p.failed}`,
        ),
      );
    });

    await safeCall('editBroadcastStatus', () =>
      bot.api.editMessageText(
        status.chat.id,
        status.message_id,
        [
          'Broadcast complete.',
          `Sent: ${final.sent}`,
          `Blocked: ${final.blocked} (marked; excluded from future broadcasts)`,
          `Failed: ${final.failed}`,
          `Total recipients: ${final.total}`,
        ].join('\n'),
      ),
    );
  });

  // Content capture: the admin's next message while a flow awaits content.
  // Passes through (next) for everything else — including native replies to
  // forwarded support messages, which always win over a broadcast draft.
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
      content = { photoFileId: photo[photo.length - 1]!.file_id, caption: ctx.message.caption };
    } else if (ctx.message.text) {
      if (ctx.message.text.startsWith('/')) {
        await ctx.reply('That looks like a command. Send the message content, or /cancel.');
        return;
      }
      content = { text: ctx.message.text };
    }

    if (!content) {
      await ctx.reply('Text, or a photo with a caption — nothing else broadcasts. Try again, or /cancel.');
      return;
    }

    state.content = content;
    state.step = 'confirm';

    // Preview exactly as users will see it, then ask for the go.
    if (content.photoFileId) {
      await safeCall('sendPhoto', () =>
        ctx.api.sendPhoto(ctx.chat.id, content.photoFileId!, { caption: content.caption }),
      );
    } else {
      await ctx.reply(content.text!);
    }
    await ctx.reply(`That's the preview above. Send to ${state.count} users?`, {
      reply_markup: new InlineKeyboard().text('Send', 'bcast:send').text('Cancel', 'bcast:cancel'),
    });
  });
}
