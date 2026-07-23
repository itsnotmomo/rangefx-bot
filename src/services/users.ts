import { count, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, type User } from '../db/schema.js';

export interface UpsertUserInput {
  telegramUserId: bigint;
  telegramUsername?: string | null;
  firstName?: string | null;
  email?: string | null;
  stripeCustomerId?: string | null;
  source?: 'legacy_import' | 'bot';
}

/**
 * Insert or update a user keyed on telegram_user_id. On conflict we COALESCE so
 * a fresh non-null value wins but a null never blanks out something we already
 * learned elsewhere (e.g. an email captured at checkout survives a later /start).
 */
export async function upsertUser(input: UpsertUserInput): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      telegramUserId: input.telegramUserId,
      telegramUsername: input.telegramUsername ?? null,
      firstName: input.firstName ?? null,
      email: input.email ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
      source: input.source ?? 'bot',
    })
    .onConflictDoUpdate({
      target: users.telegramUserId,
      set: {
        telegramUsername: sql`COALESCE(EXCLUDED.telegram_username, ${users.telegramUsername})`,
        firstName: sql`COALESCE(EXCLUDED.first_name, ${users.firstName})`,
        email: sql`COALESCE(EXCLUDED.email, ${users.email})`,
        stripeCustomerId: sql`COALESCE(EXCLUDED.stripe_customer_id, ${users.stripeCustomerId})`,
      },
    })
    .returning();
  return row!;
}

export async function getUser(telegramUserId: bigint): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.telegramUserId, telegramUserId)).limit(1);
  return row;
}

export async function getUserByStripeCustomer(stripeCustomerId: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.stripeCustomerId, stripeCustomerId)).limit(1);
  return row;
}

export async function setStripeCustomerId(telegramUserId: bigint, stripeCustomerId: string): Promise<void> {
  await db.update(users).set({ stripeCustomerId }).where(eq(users.telegramUserId, telegramUserId));
}

/** All user ids, for broadcast. Returned in id order for stable pagination. */
export async function allUserIds(): Promise<bigint[]> {
  const rows = await db.select({ id: users.telegramUserId }).from(users).orderBy(users.telegramUserId);
  return rows.map((r) => r.id);
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(users);
  return row?.value ?? 0;
}
