import cron from 'node-cron';
import { type Api } from 'grammy';
import { config } from '../config/index.js';
import { log } from '../util/logger.js';
import { allPastDue } from '../services/subscriptions.js';
import { getUser } from '../services/users.js';
import { hasLiveGroupGrant, revokeGroupAccess } from '../access/grants.js';
import { createBillingPortalSession } from '../stripe/checkout.js';
import { safeSendMessage } from '../telegram/safe.js';
import { t } from '../bot/content.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / DAY_MS);
}

/**
 * Daily reconciliation for past_due subscriptions:
 *   • Day 1 overdue  -> a single warning DM with a portal link.
 *   • >= GRACE_DAYS  -> remove from the group (ban+unban) and DM the notice.
 *
 * This is deliberately gentle: a temporary card decline shouldn't kick a member
 * the same day. Removal only touches users who still hold a live grant, so the
 * job is safe to run repeatedly.
 */
export async function runGraceCheck(api: Api): Promise<void> {
  const pastDue = await allPastDue();
  log.info('grace check started', { candidates: pastDue.length, graceDays: config.graceDays });

  let warned = 0;
  let removed = 0;

  for (const sub of pastDue) {
    const overdue = daysSince(sub.currentPeriodEnd) ?? daysSince(sub.updatedAt);
    if (overdue === null) continue;

    const telegramUserId = sub.telegramUserId;

    if (overdue >= config.graceDays) {
      if (!(await hasLiveGroupGrant(telegramUserId))) continue; // already removed
      await revokeGroupAccess(api, telegramUserId, 'grace_period_expired', {
        dm: true,
        notice: t('dm.access_revoked'),
      });
      removed++;
      continue;
    }

    if (overdue === 1) {
      const user = await getUser(telegramUserId);
      let portalUrl = config.publicUrl;
      if (user?.stripeCustomerId) {
        try {
          portalUrl = await createBillingPortalSession(user.stripeCustomerId);
        } catch (err) {
          log.warn('grace warning: portal session failed', { telegramUserId, error: err });
        }
      }
      await safeSendMessage(api, telegramUserId, t('dm.grace_warning', { portalUrl, days: config.graceDays }));
      warned++;
    }
  }

  log.info('grace check finished', { warned, removed });
}

/** Register the daily cron. Default 09:00 UTC; override with GRACE_CRON. */
export function scheduleGraceJob(api: Api): void {
  const expr = process.env.GRACE_CRON?.trim() || '0 9 * * *';
  if (!cron.validate(expr)) {
    log.error('invalid GRACE_CRON, falling back to daily 09:00 UTC', { expr });
  }
  const schedule = cron.validate(expr) ? expr : '0 9 * * *';
  cron.schedule(schedule, () => {
    runGraceCheck(api).catch((err) => log.error('grace check crashed', { error: err }));
  }, { timezone: 'UTC' });
  log.info('grace job scheduled', { schedule });
}
