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
 * News-module tables, deliberately kept OUT of src/db/schema.ts.
 *
 * That file describes the live billing/access system; this module is additive
 * and self-contained, so it carries its own table definitions and touches
 * nothing that Stripe, subscriptions or access grants depend on. The shared
 * `db` pool is reused as-is — Drizzle's query builder does not require a table
 * to be registered on the client to query it.
 *
 * Mirrors migrations/0007_news_module.sql.
 */

export type Impact = 'low' | 'medium' | 'high';
export type DeliveryKind = 'pre_5m' | 'release' | 'result';

/** Ranking used by the min-impact filter. */
export const IMPACT_RANK: Record<Impact, number> = { low: 1, medium: 2, high: 3 };

export const economicEvents = pgTable('economic_events', {
  id: serial('id').primaryKey(),
  /** Adapter that produced this row: 'mock' | 'rapidapi' | 'trading_economics'. */
  provider: text('provider').notNull(),
  /**
   * Our occurrence key, unique per provider.
   *
   * TE uses CalendarId directly. RapidAPI composes `eventId:YYYY-MM-DD` because
   * its eventId may identify a recurring series rather than one occurrence —
   * see migrations/0010.
   */
  providerEventId: text('provider_event_id').notNull(),
  currency: text('currency').notNull(),
  title: text('title').notNull(),
  impact: text('impact').$type<Impact>().notNull(),
  /** True UTC instant. Normalisation is the adapter's job, not this layer's. */
  releaseAt: timestamp('release_at', { withTimezone: true }).notNull(),
  // Readings stay TEXT — "145K", "3.2%", "-0.4" must round-trip verbatim.
  previous: text('previous'),
  forecast: text('forecast'),
  actual: text('actual'),
  revised: text('revised'),
  /** Unit for the readings above, e.g. "%" or "Jobs". Applied at render time. */
  unit: text('unit'),
  actualReceivedAt: timestamp('actual_received_at', { withTimezone: true }),

  // --- Provider classification. These change behaviour; see 0011.
  /** Release time is an estimate, not a schedule (BoJ). */
  isTentative: boolean('is_tentative').notNull().default(false),
  /** Event is dated but not timed — same consequence as tentative. */
  isAllDay: boolean('is_all_day').notNull().default(false),
  /** A speech or press conference: "Begins"/"Starting", and never prints. */
  isSpeech: boolean('is_speech').notNull().default(false),
  /** A statement or written report: never prints a number. */
  isReport: boolean('is_report').notNull().default(false),

  // --- Informational only. NOTHING below is read by the renderer; the
  // deviation line stays ours to compute from actual and forecast.
  /** RapidAPI `id`, verbatim. */
  providerRowId: text('provider_row_id'),
  /** RapidAPI `eventId`, verbatim — the possibly-per-series identifier. */
  providerSeriesId: text('provider_series_id'),
  potency: text('potency'),
  ratioDeviation: text('ratio_deviation'),
  periodDateUtc: timestamp('period_date_utc', { withTimezone: true }),
  periodType: text('period_type'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerEventUnique: uniqueIndex('economic_events_provider_event_unique').on(t.provider, t.providerEventId),
  releaseIdx: index('economic_events_release_idx').on(t.releaseAt),
  seriesIdx: index('economic_events_series_idx').on(t.provider, t.providerSeriesId),
}));

/**
 * One row per message posted to the topic. The unique (event_id, kind) index is
 * the dedup guarantee — every job claims its slot here before it sends.
 */
export const newsDeliveries = pgTable('news_deliveries', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id')
    .notNull()
    .references(() => economicEvents.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<DeliveryKind>().notNull(),
  /** Null between claiming the slot and Telegram confirming the send. */
  telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  eventKindUnique: uniqueIndex('news_deliveries_event_kind_unique').on(t.eventId, t.kind),
  eventIdx: index('news_deliveries_event_idx').on(t.eventId),
}));

/** Singleton settings row (id = 1, enforced by a CHECK constraint). */
export const newsSettings = pgTable('news_settings', {
  id: integer('id').primaryKey().default(1),
  /** Comma-separated, e.g. 'USD,EUR,JPY'. */
  currencies: text('currencies').notNull().default('USD,EUR,JPY'),
  minImpact: text('min_impact').$type<Impact>().notNull().default('high'),
  /** 'HH:MM' in the desk timezone. Null falls back to NEWS_QUIET_START/END. */
  quietStart: text('quiet_start'),
  quietEnd: text('quiet_end'),
  paused: boolean('paused').notNull().default(false),
  /** Stamped on every successful import — a stale value means the job is failing. */
  lastImportAt: timestamp('last_import_at', { withTimezone: true }),
  /** 'YYYY-MM' (UTC) in which the quota-cap DM was already sent. Self-resetting. */
  capNotifiedMonth: text('cap_notified_month'),
  /** True when the last import came back at the provider's row limit. */
  lastImportTruncated: boolean('last_import_truncated').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per outbound request to a paid provider API, so /news_status can show
 * quota consumption before a plan limit is hit rather than after.
 */
export const newsProviderRequests = pgTable('news_provider_requests', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull(),
  /** 'calendar' | 'result' — which call shape consumed the quota. */
  endpoint: text('endpoint').$type<ProviderEndpoint>().notNull(),
  ok: boolean('ok').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerTimeIdx: index('news_provider_requests_provider_time_idx').on(t.provider, t.createdAt),
}));

export type ProviderEndpoint = 'calendar' | 'result';

/**
 * Scheduling predicates.
 *
 * The repo's SQL filters mirror these exactly. Kept here, next to the columns
 * they read, so the TypeScript and the WHERE clauses stay recognisably the
 * same rule — and so the behaviour is unit-testable without a database.
 */

/**
 * True when the provider's timestamp is an estimate rather than a schedule.
 *
 * The number still looks like a real time — BoJ carries 03:00 — so nothing
 * downstream can infer this from the timestamp alone. Everything that would
 * fire *relative to* that time must be suppressed: silent beats wrong.
 */
export function timeIsUnscheduled(e: { isTentative: boolean; isAllDay: boolean }): boolean {
  return e.isTentative || e.isAllDay;
}

/** True when this event should get T-5 and release posts on a timetable. */
export function announcesSchedule(e: { isTentative: boolean; isAllDay: boolean }): boolean {
  return !timeIsUnscheduled(e);
}

/**
 * True when the event will never produce a number — a speech, a press
 * conference, a written statement. Polling these forever would spend quota on
 * an actual that is never coming.
 */
export function expectsNoActual(e: { isSpeech: boolean; isReport: boolean }): boolean {
  return e.isSpeech || e.isReport;
}

export type EconomicEvent = typeof economicEvents.$inferSelect;
export type NewsDelivery = typeof newsDeliveries.$inferSelect;
export type NewsSettings = typeof newsSettings.$inferSelect;
