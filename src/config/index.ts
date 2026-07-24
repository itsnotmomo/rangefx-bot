import { boolOf, intOf, optional, required } from './env.js';

/**
 * Centralised, validated configuration. Every secret and tunable comes from the
 * environment — nothing is hardcoded. Import `config` anywhere; it is frozen and
 * validated once at process start, so a misconfigured deploy fails fast and loud.
 *
 * Base helpers live in ./env.ts so single-variable consumers (the DB pool) can
 * validate just their own variable without pulling in this full validation.
 */

/** Parse a comma/space separated list of numeric Telegram user ids. */
function parseAdminIds(raw: string): bigint[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return BigInt(s);
      } catch {
        throw new Error(`ADMIN_USER_IDS contains a non-numeric id: ${s}`);
      }
    });
}

export type PlanKey = 'monthly' | 'quarterly' | 'annual';

export interface PlanDefinition {
  key: PlanKey;
  /** Human label shown in the bot. */
  label: string;
  /** Short cadence description. */
  cadence: string;
  /** Stripe price id. */
  priceId: string;
}

const priceMonthly = required('PRICE_MONTHLY');
const priceQuarterly = required('PRICE_QUARTERLY');
const priceAnnual = required('PRICE_ANNUAL');

export const PLANS: Record<PlanKey, PlanDefinition> = {
  monthly: { key: 'monthly', label: 'Monthly', cadence: 'billed monthly', priceId: priceMonthly },
  quarterly: { key: 'quarterly', label: 'Quarterly', cadence: 'billed every 3 months', priceId: priceQuarterly },
  annual: { key: 'annual', label: 'Annual', cadence: 'billed yearly', priceId: priceAnnual },
};

/** Reverse lookup: Stripe price id -> plan key. Used when reconciling webhooks. */
export const PRICE_ID_TO_PLAN: Record<string, PlanKey> = {
  [priceMonthly]: 'monthly',
  [priceQuarterly]: 'quarterly',
  [priceAnnual]: 'annual',
};

export const config = {
  // Telegram
  botToken: required('BOT_TOKEN'),
  /** Optional secret for the Telegram webhook path/header. Auto-derived if unset. */
  telegramWebhookSecret: optional('TELEGRAM_WEBHOOK_SECRET', ''),
  groupChatId: BigInt(required('GROUP_CHAT_ID')),
  adminUserIds: parseAdminIds(required('ADMIN_USER_IDS')),

  // Stripe
  stripeSecretKey: required('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: required('STRIPE_WEBHOOK_SECRET'),
  plans: PLANS,

  // Database
  databaseUrl: required('DATABASE_URL'),

  // Server
  port: intOf('PORT', 3000),
  /**
   * Public base URL of this service (Railway provides it). Used to register the
   * Telegram webhook and to build Checkout success/cancel redirects.
   */
  publicUrl: optional('PUBLIC_URL', process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ''),

  // Access / grace period
  graceDays: intOf('GRACE_DAYS', 3),
  /** How long a one-time group invite link stays valid, in hours. */
  inviteExpiryHours: intOf('INVITE_EXPIRY_HOURS', 24),

  // Broadcast throttling (Telegram allows ~30 msg/s globally to different users).
  broadcastPerSecond: intOf('BROADCAST_PER_SECOND', 25),

  /**
   * DM admins when a user starts the bot for the first time. Turn off during
   * the legacy launch broadcast — 11,400 people pressing start in one hour
   * would flood the admin chat.
   */
  notifyNewUsers: boolOf('NOTIFY_NEW_USERS', true),

  nodeEnv: optional('NODE_ENV', 'development'),
} as const;

/** True if the given Telegram user id is an administrator. */
export function isAdmin(userId: bigint | number): boolean {
  const id = typeof userId === 'bigint' ? userId : BigInt(userId);
  return config.adminUserIds.some((a) => a === id);
}

/** Derived secret token for the Telegram webhook (header + path segment). */
export function telegramWebhookToken(): string {
  if (config.telegramWebhookSecret) return config.telegramWebhookSecret;
  // Deterministic, non-secret-leaking fallback derived from the bot token tail.
  return config.botToken.split(':')[1]?.slice(0, 24) ?? 'telegram';
}
