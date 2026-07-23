import cron from 'node-cron';
import { type Api } from 'grammy';
import { log } from '../util/logger.js';
import {
  cancelPendingFollowups,
  dueFollowups,
  markFollowupSent,
} from '../services/funnel.js';
import { hasLiveGroupGrant } from '../access/grants.js';
import { recordEvent } from '../services/events.js';
import { safeSendMessage } from '../telegram/safe.js';
import { FOLLOWUP_1, FOLLOWUP_2 } from '../bot/content.js';
import { plansKeyboard } from '../bot/keyboards.js';

/**
 * Lead follow-up delivery. Runs frequently (default every 10 minutes) so the
 * +1 hour touch lands close to on time.
 *
 * Hard rules, enforced here and in the schema:
 *   • A user who paid — or who already holds group access (e.g. a legacy
 *     member) — is never messaged; their pending rows are cancelled.
 *   • A row is marked sent even when delivery fails (blocked, deleted account).
 *     Two touches maximum, ever. Silence after that is the point.
 */
export async function runFollowupCheck(api: Api): Promise<void> {
  const due = await dueFollowups();
  if (due.length === 0) return;
  log.info('followup check started', { due: due.length });

  let sent = 0;
  let cancelled = 0;

  for (const f of due) {
    // Paid (or otherwise already inside) between scheduling and now -> silence.
    if (f.paidAt || (await hasLiveGroupGrant(f.telegramUserId))) {
      await cancelPendingFollowups(f.telegramUserId);
      cancelled++;
      continue;
    }

    const text = f.stage === 1 ? FOLLOWUP_1 : FOLLOWUP_2;
    const res = await safeSendMessage(api, f.telegramUserId, text, {
      reply_markup: plansKeyboard(),
    });
    // Mark handled regardless of delivery — a follow-up is never retried.
    await markFollowupSent(f.id);
    await recordEvent({
      type: 'followup.sent',
      telegramUserId: f.telegramUserId,
      payload: { stage: f.stage, delivered: res.ok },
    });
    if (res.ok) sent++;
  }

  log.info('followup check finished', { sent, cancelled });
}

/** Register the follow-up cron. Default every 10 minutes; override with FOLLOWUP_CRON. */
export function scheduleFollowupJob(api: Api): void {
  const expr = process.env.FOLLOWUP_CRON?.trim() || '*/10 * * * *';
  if (!cron.validate(expr)) {
    log.error('invalid FOLLOWUP_CRON, falling back to every 10 minutes', { expr });
  }
  const schedule = cron.validate(expr) ? expr : '*/10 * * * *';
  cron.schedule(schedule, () => {
    runFollowupCheck(api).catch((err) => log.error('followup check crashed', { error: err }));
  }, { timezone: 'UTC' });
  log.info('followup job scheduled', { schedule });
}
