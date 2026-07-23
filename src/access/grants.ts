import { and, eq, isNull } from 'drizzle-orm';
import { type Api } from 'grammy';
import { db } from '../db/index.js';
import { accessGrants } from '../db/schema.js';
import { config } from '../config/index.js';
import { log } from '../util/logger.js';
import { recordEvent } from '../services/events.js';
import { safeCall, safeSendMessage } from '../telegram/safe.js';
import { GROUP_INVITE_DM } from '../bot/content.js';

const RESOURCE_TYPE = 'telegram_group';

function groupResourceId(): string {
  return config.groupChatId.toString();
}

/**
 * Mint a single-use group invite link that expires in ~INVITE_EXPIRY_HOURS.
 * Does NOT touch grants — used both when granting access and when re-issuing
 * a link to an already-authorised member. Returns null if Telegram refused.
 */
export async function mintInviteLink(api: Api, telegramUserId: bigint, label: string): Promise<string | null> {
  const expireDate = Math.floor(Date.now() / 1000) + config.inviteExpiryHours * 3600;
  const linkResult = await safeCall('createChatInviteLink', () =>
    api.createChatInviteLink(Number(config.groupChatId), {
      member_limit: 1,
      expire_date: expireDate,
      name: `${label}:${telegramUserId}`,
    }),
  );
  return linkResult.ok ? linkResult.value.invite_link : null;
}

/** Is there a live (not-yet-revoked) grant for this user on the group? */
export async function hasLiveGroupGrant(telegramUserId: bigint): Promise<boolean> {
  const [row] = await db
    .select({ id: accessGrants.id })
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.telegramUserId, telegramUserId),
        eq(accessGrants.resourceType, RESOURCE_TYPE),
        eq(accessGrants.resourceId, groupResourceId()),
        isNull(accessGrants.revokedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Grant a user access to the Telegram group:
 *   1. Mint a single-use invite link that expires in ~INVITE_EXPIRY_HOURS.
 *   2. Record a live access_grants row + an audit event.
 *   3. DM the link to the user.
 *
 * Steps are wrapped so a blocked user still leaves a durable grant on record —
 * we simply couldn't deliver the link, and they can request it again via /status.
 * Returns the invite link when one was created.
 */
export async function grantGroupAccess(
  api: Api,
  telegramUserId: bigint,
  reason: string,
  opts: { dm?: boolean } = { dm: true },
): Promise<string | null> {
  const inviteLink = await mintInviteLink(api, telegramUserId, 'grant');

  // Record the grant regardless of link/DM success — access is authorised now.
  await db.insert(accessGrants).values({
    telegramUserId,
    resourceType: RESOURCE_TYPE,
    resourceId: groupResourceId(),
    reason,
  });
  await recordEvent({ type: 'access.granted', telegramUserId, payload: { reason } });

  log.info('access granted', {
    event: 'access.granted',
    telegramUserId,
    resourceType: RESOURCE_TYPE,
    resourceId: groupResourceId(),
    reason,
    inviteLinkCreated: inviteLink !== null,
  });

  if (!inviteLink) {
    log.warn('invite link not created', { telegramUserId, reason });
    return null;
  }

  if (opts.dm !== false) {
    const dm = await safeSendMessage(api, telegramUserId, GROUP_INVITE_DM(inviteLink, config.inviteExpiryHours));
    if (!dm.ok) {
      log.warn('could not DM invite link', { telegramUserId, blocked: dm.blocked });
    }
  }

  return inviteLink;
}

/**
 * Revoke a user's group access. Uses ban-then-unban so the member is removed
 * without a permanent ban — they can be re-invited later if they resubscribe.
 * Marks every live grant as revoked and writes an audit event.
 */
export async function revokeGroupAccess(
  api: Api,
  telegramUserId: bigint,
  reason: string,
  opts: { dm?: boolean; notice?: string } = {},
): Promise<void> {
  // ban removes them; unban immediately clears the ban so they can rejoin later.
  const ban = await safeCall('banChatMember', () =>
    api.banChatMember(Number(config.groupChatId), Number(telegramUserId)),
  );
  if (ban.ok) {
    await safeCall('unbanChatMember', () =>
      api.unbanChatMember(Number(config.groupChatId), Number(telegramUserId), { only_if_banned: true }),
    );
  }

  await db
    .update(accessGrants)
    .set({ revokedAt: new Date(), reason })
    .where(
      and(
        eq(accessGrants.telegramUserId, telegramUserId),
        eq(accessGrants.resourceType, RESOURCE_TYPE),
        eq(accessGrants.resourceId, groupResourceId()),
        isNull(accessGrants.revokedAt),
      ),
    );
  await recordEvent({ type: 'access.revoked', telegramUserId, payload: { reason } });

  log.info('access revoked', {
    event: 'access.revoked',
    telegramUserId,
    resourceType: RESOURCE_TYPE,
    resourceId: groupResourceId(),
    reason,
    removed: ban.ok,
  });

  if (opts.dm !== false && opts.notice) {
    await safeSendMessage(api, telegramUserId, opts.notice);
  }
}
