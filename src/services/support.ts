import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { supportRoutes } from '../db/schema.js';

/**
 * Support reply-routing. When a user's message is forwarded to an admin, we
 * remember which bot message (in that admin's chat) corresponds to which user.
 * An admin answering with a native Telegram reply is then routed automatically —
 * it feels like texting, not command-line. /reply <id> stays as the fallback.
 */

export async function saveSupportRoute(
  adminChatId: bigint | number,
  messageId: number,
  telegramUserId: bigint,
): Promise<void> {
  await db
    .insert(supportRoutes)
    .values({
      adminChatId: BigInt(adminChatId),
      messageId: BigInt(messageId),
      telegramUserId,
    })
    .onConflictDoNothing();
}

/** The user behind a forwarded support message, or null if not one of ours. */
export async function findSupportRoute(
  adminChatId: bigint | number,
  messageId: number,
): Promise<bigint | null> {
  const [row] = await db
    .select({ telegramUserId: supportRoutes.telegramUserId })
    .from(supportRoutes)
    .where(
      and(
        eq(supportRoutes.adminChatId, BigInt(adminChatId)),
        eq(supportRoutes.messageId, BigInt(messageId)),
      ),
    )
    .limit(1);
  return row?.telegramUserId ?? null;
}
