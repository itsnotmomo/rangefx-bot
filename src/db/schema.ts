import {
  bigint,
  boolean,
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Schema notes
 * ------------
 * The design deliberately decouples three concerns so we can add products
 * (courses, ebooks, other groups) later without reworking billing:
 *
 *   users          — identity, one row per Telegram account.
 *   subscriptions  — Stripe billing state (one row per Stripe subscription).
 *   access_grants  — the ACCESS layer. This is the source of truth for "who is
 *                    allowed into resource X". Today the only resource is the
 *                    Telegram group; tomorrow it can be a course or an ebook.
 *                    Grants are decoupled from Stripe on purpose: a legacy
 *                    member, a comped account, or a future non-Stripe product
 *                    can all hold a grant.
 *   events         — append-only audit log for every Stripe webhook and every
 *                    access change. `stripe_event_id` is unique, giving us
 *                    webhook idempotency for free.
 */

export const users = pgTable('users', {
  telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }).primaryKey(),
  telegramUsername: text('telegram_username'),
  firstName: text('first_name'),
  email: text('email'),
  stripeCustomerId: text('stripe_customer_id'),
  /** 'legacy_import' | 'bot' — where the user record originated. */
  source: text('source').notNull().default('bot'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stripeCustomerIdx: index('users_stripe_customer_idx').on(t.stripeCustomerId),
}));

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  telegramUserId: bigint('telegram_user_id', { mode: 'bigint' })
    .notNull()
    .references(() => users.telegramUserId, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripePriceId: text('stripe_price_id'),
  /** Plan key: monthly | quarterly | annual (see config.PLANS). */
  plan: text('plan'),
  /** Stripe subscription status: active | past_due | canceled | ... */
  status: text('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stripeSubUnique: uniqueIndex('subscriptions_stripe_sub_unique').on(t.stripeSubscriptionId),
  userIdx: index('subscriptions_user_idx').on(t.telegramUserId),
  statusIdx: index('subscriptions_status_idx').on(t.status),
}));

/** Resource types an access grant can point at. Extend as products are added. */
export type ResourceType = 'telegram_group';

export const accessGrants = pgTable('access_grants', {
  id: serial('id').primaryKey(),
  telegramUserId: bigint('telegram_user_id', { mode: 'bigint' })
    .notNull()
    .references(() => users.telegramUserId, { onDelete: 'cascade' }),
  /** 'telegram_group' today; 'course', 'ebook', ... in the future. */
  resourceType: text('resource_type').notNull(),
  /** Identifier of the resource, e.g. the group chat id as text. */
  resourceId: text('resource_id').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  /** Null while the grant is live; set when access is revoked. */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  /** Free-text explanation, e.g. 'checkout.session.completed', 'grace_period_expired'. */
  reason: text('reason'),
}, (t) => ({
  userResourceIdx: index('access_grants_user_resource_idx').on(t.telegramUserId, t.resourceType, t.resourceId),
  liveIdx: index('access_grants_live_idx').on(t.resourceType, t.revokedAt),
}));

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  /** Unique when the event came from Stripe — this is our idempotency key. */
  stripeEventId: text('stripe_event_id'),
  /** e.g. 'checkout.session.completed', 'access.granted', 'access.revoked'. */
  type: text('type').notNull(),
  telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }),
  /** Arbitrary JSON payload, stored as text for portability. */
  payload: text('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stripeEventUnique: uniqueIndex('events_stripe_event_unique').on(t.stripeEventId),
  typeIdx: index('events_type_idx').on(t.type),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type AccessGrant = typeof accessGrants.$inferSelect;
