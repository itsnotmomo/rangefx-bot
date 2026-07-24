import {
  bigint,
  boolean,
  index,
  integer,
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
  /**
   * Raw status from the legacy InviteMember export ('lead' | 'customer' |
   * 'churned'). Purely informational — no behavioral effect anywhere.
   */
  legacyStatus: text('legacy_status'),
  /** Deep-link payload from the user's FIRST /start (e.g. 'website'); 'direct' if none. */
  acquisitionSource: text('acquisition_source'),
  // Funnel timestamps — each records the FIRST time the user hit that stage.
  /**
   * First real /start. Null for legacy-imported rows (they have a row but never
   * truly started this bot). The null → set transition drives the "new user"
   * admin notification; already-set means "returning".
   */
  firstStartedAt: timestamp('first_started_at', { withTimezone: true }),
  viewedPlansAt: timestamp('viewed_plans_at', { withTimezone: true }),
  openedCheckoutAt: timestamp('opened_checkout_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  /** Set when a send hits a 403 (user blocked the bot); cleared on inbound activity. */
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
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

/**
 * Scheduled follow-up touches for users who viewed plans / opened checkout but
 * haven't paid. One row per (user, stage); stage 1 = +1h, stage 2 = +24h.
 * Unsent rows are deleted the moment the user pays — two touches maximum, ever.
 */
export const followups = pgTable('followups', {
  id: serial('id').primaryKey(),
  telegramUserId: bigint('telegram_user_id', { mode: 'bigint' })
    .notNull()
    .references(() => users.telegramUserId, { onDelete: 'cascade' }),
  /** 1 (+1 hour) | 2 (+24 hours). */
  stage: integer('stage').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userStageUnique: uniqueIndex('followups_user_stage_unique').on(t.telegramUserId, t.stage),
  dueIdx: index('followups_due_idx').on(t.scheduledAt),
}));

/**
 * Maps a forwarded support message (in an admin's chat) back to the user who
 * wrote it, so admins can answer with a native Telegram reply instead of /reply.
 */
export const supportRoutes = pgTable('support_routes', {
  id: serial('id').primaryKey(),
  adminChatId: bigint('admin_chat_id', { mode: 'bigint' }).notNull(),
  messageId: bigint('message_id', { mode: 'bigint' }).notNull(),
  telegramUserId: bigint('telegram_user_id', { mode: 'bigint' })
    .notNull()
    .references(() => users.telegramUserId, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chatMsgUnique: uniqueIndex('support_routes_chat_msg_unique').on(t.adminChatId, t.messageId),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type AccessGrant = typeof accessGrants.$inferSelect;
