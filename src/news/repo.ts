import { and, asc, count, eq, gt, gte, isNotNull, isNull, lt, lte, ne, notExists, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  economicEvents,
  newsDeliveries,
  newsProviderRequests,
  newsSettings,
  type DeliveryKind,
  type EconomicEvent,
  type Impact,
  type NewsSettings,
  type ProviderEndpoint,
  IMPACT_RANK,
} from './schema.js';
import { type RawEvent, type RawResult } from './types.js';
import { utcMonthStart } from './time.js';

/**
 * Every database access the news module makes. Kept in one file so the jobs
 * read as pure control flow and the dedup guarantees live in exactly one place.
 */

const SETTINGS_ID = 1;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The singleton settings row, self-healing if it was ever deleted. */
export async function getSettings(): Promise<NewsSettings> {
  const [row] = await db.select().from(newsSettings).where(eq(newsSettings.id, SETTINGS_ID)).limit(1);
  if (row) return row;
  const [created] = await db.insert(newsSettings).values({ id: SETTINGS_ID }).onConflictDoNothing().returning();
  if (created) return created;
  // Lost an insert race — the row exists now.
  const [again] = await db.select().from(newsSettings).where(eq(newsSettings.id, SETTINGS_ID)).limit(1);
  if (!again) throw new Error('news_settings row missing and could not be created');
  return again;
}

export async function setPaused(paused: boolean): Promise<void> {
  await db
    .update(newsSettings)
    .set({ paused, updatedAt: new Date() })
    .where(eq(newsSettings.id, SETTINGS_ID));
}

/**
 * Stamp a completed import. `truncated` is written on every run, including the
 * clean ones, so the flag reflects the CURRENT state rather than latching on
 * the first bad import and never clearing.
 */
export async function markImported(at: Date = new Date(), truncated = false): Promise<void> {
  await db
    .update(newsSettings)
    .set({ lastImportAt: at, lastImportTruncated: truncated, updatedAt: new Date() })
    .where(eq(newsSettings.id, SETTINGS_ID));
}

/** Enabled currencies as an uppercase set. */
export function enabledCurrencies(settings: NewsSettings): Set<string> {
  return new Set(
    settings.currencies
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  );
}

/** Whether an event clears the configured currency + impact floor. */
export function passesFilter(settings: NewsSettings, currency: string, impact: Impact): boolean {
  const currencies = enabledCurrencies(settings);
  if (currencies.size > 0 && !currencies.has(currency.toUpperCase())) return false;
  return IMPACT_RANK[impact] >= IMPACT_RANK[settings.minImpact];
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Upsert on (provider, provider_event_id).
 *
 * `actual` and `revised` are COALESCEd rather than overwritten: a later import
 * that hasn't seen the print yet must never erase a number the result poll has
 * already captured and posted.
 */
export async function upsertEvents(provider: string, events: RawEvent[]): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
    provider,
    providerEventId: e.providerEventId,
    currency: e.currency.toUpperCase(),
    title: e.title,
    impact: e.impact,
    releaseAt: e.releaseAt,
    previous: e.previous,
    forecast: e.forecast,
    actual: e.actual,
    revised: e.revised,
    isTentative: e.isTentative ?? false,
    isAllDay: e.isAllDay ?? false,
    isSpeech: e.isSpeech ?? false,
    isReport: e.isReport ?? false,
    // Informational passthrough — recorded, never rendered.
    providerRowId: e.meta?.providerRowId ?? null,
    providerSeriesId: e.meta?.providerSeriesId ?? null,
    potency: e.meta?.potency ?? null,
    ratioDeviation: e.meta?.ratioDeviation ?? null,
    periodDateUtc: e.meta?.periodDateUtc ?? null,
    periodType: e.meta?.periodType ?? null,
  }));

  const written = await db
    .insert(economicEvents)
    .values(rows)
    .onConflictDoUpdate({
      target: [economicEvents.provider, economicEvents.providerEventId],
      set: {
        currency: sql`excluded.currency`,
        title: sql`excluded.title`,
        impact: sql`excluded.impact`,
        releaseAt: sql`excluded.release_at`,
        previous: sql`excluded.previous`,
        forecast: sql`excluded.forecast`,
        actual: sql`coalesce(excluded.actual, ${economicEvents.actual})`,
        revised: sql`coalesce(excluded.revised, ${economicEvents.revised})`,
        // Overwritten rather than coalesced: these are never null, and a
        // provider that reclassifies an event (tentative -> scheduled once the
        // time is fixed) must be able to say so.
        isTentative: sql`excluded.is_tentative`,
        isAllDay: sql`excluded.is_all_day`,
        isSpeech: sql`excluded.is_speech`,
        isReport: sql`excluded.is_report`,
        // Same rule as the readings: a later import that omits a field must
        // not erase what an earlier one captured.
        providerRowId: sql`coalesce(excluded.provider_row_id, ${economicEvents.providerRowId})`,
        providerSeriesId: sql`coalesce(excluded.provider_series_id, ${economicEvents.providerSeriesId})`,
        potency: sql`coalesce(excluded.potency, ${economicEvents.potency})`,
        ratioDeviation: sql`coalesce(excluded.ratio_deviation, ${economicEvents.ratioDeviation})`,
        periodDateUtc: sql`coalesce(excluded.period_date_utc, ${economicEvents.periodDateUtc})`,
        periodType: sql`coalesce(excluded.period_type, ${economicEvents.periodType})`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: economicEvents.id });

  return written.length;
}

/** Persist a single synthetic event (used by /news_test). Returns its row. */
export async function upsertOneEvent(provider: string, event: RawEvent): Promise<EconomicEvent> {
  await upsertEvents(provider, [event]);
  const [row] = await db
    .select()
    .from(economicEvents)
    .where(and(eq(economicEvents.provider, provider), eq(economicEvents.providerEventId, event.providerEventId)))
    .limit(1);
  if (!row) throw new Error(`event ${provider}/${event.providerEventId} vanished after upsert`);
  return row;
}

/** Correlated "this event has no delivery of `kind` yet". */
function noDelivery(kind: DeliveryKind) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(newsDeliveries)
      .where(and(eq(newsDeliveries.eventId, economicEvents.id), eq(newsDeliveries.kind, kind))),
  );
}

/**
 * SQL mirrors of the predicates in schema.ts. Kept as named constants so the
 * WHERE clauses read as the same rule the unit tests assert.
 */
/** The provider gave us a real schedule, not an estimate. */
const timeIsScheduled = sql`not (${economicEvents.isTentative} or ${economicEvents.isAllDay})`;
/** The event can actually print a number. */
const mayPrintActual = sql`not (${economicEvents.isSpeech} or ${economicEvents.isReport})`;

/** Correlated "this event HAS a delivery of `kind`". */
function hasDelivery(kind: DeliveryKind) {
  return sql`exists (
    select 1 from ${newsDeliveries}
    where ${newsDeliveries.eventId} = ${economicEvents.id}
      and ${newsDeliveries.kind} = ${kind}
  )`;
}

/**
 * Events releasing in 5–6 minutes that have not had their T-5 notice.
 *
 * The one-minute-wide window matches the one-minute cron: every event passes
 * through it exactly once. A missed tick simply means no reminder — never a
 * late one, which would be worse than silence.
 */
export async function dueReminders(now: Date = new Date()): Promise<EconomicEvent[]> {
  const from = new Date(now.getTime() + 5 * 60_000);
  const to = new Date(now.getTime() + 6 * 60_000);
  return db
    .select()
    .from(economicEvents)
    .where(
      and(
        gte(economicEvents.releaseAt, from),
        lt(economicEvents.releaseAt, to),
        // An estimated time must never trigger a timed post.
        timeIsScheduled,
        noDelivery('pre_5m'),
      ),
    )
    .orderBy(asc(economicEvents.releaseAt));
}

/**
 * Events whose release time has arrived and that have not been announced.
 *
 * `lookbackMinutes` stops a restart after downtime from dumping a backlog of
 * stale "releasing now" messages into the topic.
 */
export async function dueReleases(now: Date = new Date(), lookbackMinutes = 5): Promise<EconomicEvent[]> {
  const floor = new Date(now.getTime() - lookbackMinutes * 60_000);
  return db
    .select()
    .from(economicEvents)
    .where(
      and(
        lte(economicEvents.releaseAt, now),
        gt(economicEvents.releaseAt, floor),
        timeIsScheduled,
        noDelivery('release'),
      ),
    )
    .orderBy(asc(economicEvents.releaseAt));
}

/**
 * Events inside the post-release polling window that were announced but whose
 * actual has not landed yet. This set being empty is what keeps the poll from
 * spending quota the rest of the day.
 */
export async function pendingResults(now: Date = new Date(), windowMinutes: number): Promise<EconomicEvent[]> {
  const floor = new Date(now.getTime() - windowMinutes * 60_000);
  return db
    .select()
    .from(economicEvents)
    .where(
      and(
        lte(economicEvents.releaseAt, now),
        gt(economicEvents.releaseAt, floor),
        isNull(economicEvents.actual),
        // A speech or statement never prints; polling it spends quota on a
        // number that is not coming.
        mayPrintActual,
        hasDelivery('release'),
        noDelivery('result'),
      ),
    )
    .orderBy(asc(economicEvents.releaseAt));
}

/**
 * Tentative events whose actual has since appeared.
 *
 * These never got a T-5 or a release post, because their timestamp was an
 * estimate — so there is no message to edit and nothing was promised. Once a
 * number exists we announce it once, as a fresh post.
 *
 * Costs no provider quota: the actual arrives via the ordinary import, so this
 * is a pure database read. That is deliberate — polling an unscheduled event
 * until its real time arrived could mean hours of requests per event.
 *
 * Bounded by `maxAgeHours` so enabling the module cannot backfill a flood of
 * historical prints into the topic.
 */
export async function pendingTentativeResults(
  now: Date = new Date(),
  maxAgeHours = 24,
): Promise<EconomicEvent[]> {
  const floor = new Date(now.getTime() - maxAgeHours * 3_600_000);
  return db
    .select()
    .from(economicEvents)
    .where(
      and(
        // or() from drizzle, NOT a raw sql`a or b` chunk.
        //
        // A raw OR is interpolated into the AND list without parentheses, and
        // OR binds looser than AND — so `x AND a OR b AND y` parses as
        // `(x AND a) OR (b AND y)` and every condition after the OR is
        // bypassed for any row matching the first branch. That shipped, and it
        // posted future-dated events with no value to the live group. or()
        // parenthesises its own group, which is why it is used here.
        or(eq(economicEvents.isTentative, true), eq(economicEvents.isAllDay, true)),
        // Non-blank, not merely non-null: an empty string passes IS NOT NULL
        // but renders as no value at all, which is how one of the bad posts
        // went out with an empty body.
        sql`${economicEvents.actual} is not null and btrim(${economicEvents.actual}) <> ''`,
        // Released ALREADY — an estimated timestamp days in the future is not
        // a result, and was the other half of the incident.
        lte(economicEvents.releaseAt, now),
        gt(economicEvents.releaseAt, floor),
        // A speech or statement never prints, so it can never have a result.
        mayPrintActual,
        noDelivery('result'),
      ),
    )
    .orderBy(asc(economicEvents.releaseAt));
}

/** Store a print and stamp when we received it. */
export async function applyResult(eventId: number, result: RawResult): Promise<void> {
  await db
    .update(economicEvents)
    .set({
      actual: result.actual,
      revised: result.revised,
      // A late-published forecast/previous is worth keeping; a null is not.
      ...(result.forecast !== null ? { forecast: result.forecast } : {}),
      ...(result.previous !== null ? { previous: result.previous } : {}),
      actualReceivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(economicEvents.id, eventId));
}

// ---------------------------------------------------------------------------
// Deliveries — the dedup layer
// ---------------------------------------------------------------------------

/**
 * Atomically claim the right to send (event, kind).
 *
 * Returns false when the row already exists, which is the whole dedup story:
 * the unique index arbitrates, so a duplicate cron tick, an overlapping run, or
 * a second process can never double-post. Claiming happens BEFORE the send —
 * the failure mode we accept is a missed message, never a repeated one.
 */
export async function claimDelivery(eventId: number, kind: DeliveryKind): Promise<boolean> {
  const rows = await db
    .insert(newsDeliveries)
    .values({ eventId, kind })
    .onConflictDoNothing()
    .returning({ id: newsDeliveries.id });
  return rows.length > 0;
}

/** Release a claim so a later tick may retry it (used when the send fails). */
export async function dropDelivery(eventId: number, kind: DeliveryKind): Promise<void> {
  await db
    .delete(newsDeliveries)
    .where(and(eq(newsDeliveries.eventId, eventId), eq(newsDeliveries.kind, kind)));
}

export async function setDeliveryMessageId(
  eventId: number,
  kind: DeliveryKind,
  telegramMessageId: number,
): Promise<void> {
  await db
    .update(newsDeliveries)
    .set({ telegramMessageId })
    .where(and(eq(newsDeliveries.eventId, eventId), eq(newsDeliveries.kind, kind)));
}

/** The message id of the release post — the message the result edits in place. */
export async function releaseMessageId(eventId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: newsDeliveries.telegramMessageId })
    .from(newsDeliveries)
    .where(and(eq(newsDeliveries.eventId, eventId), eq(newsDeliveries.kind, 'release')))
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Provider quota accounting
// ---------------------------------------------------------------------------

/** Log one outbound provider call. Never throws — accounting must not break a job. */
export async function recordProviderRequest(
  provider: string,
  endpoint: ProviderEndpoint,
  ok: boolean,
): Promise<void> {
  try {
    await db.insert(newsProviderRequests).values({ provider, endpoint, ok });
  } catch {
    // Deliberately swallowed: losing a counter row is not worth failing a fetch.
  }
}

export interface ProviderUsage {
  last24h: number;
  /** Rolling 30-day window — the figure that matters against a monthly allowance. */
  rolling30d: number;
  /** Calendar month to date, for reconciling against a vendor's own dashboard. */
  monthToDate: number;
  failures30d: number;
}

export async function providerUsage(provider: string): Promise<ProviderUsage> {
  // The month boundary is computed in JS and passed in, NOT via Postgres
  // date_trunc('month', now()) — that follows the database session's TimeZone,
  // which would reset the billing cap on a different day than the code thinks.
  const monthStart = utcMonthStart();
  const [row] = await db
    .select({
      last24h: sql<number>`count(*) filter (where ${newsProviderRequests.createdAt} >= now() - interval '24 hours')`,
      rolling30d: sql<number>`count(*) filter (where ${newsProviderRequests.createdAt} >= now() - interval '30 days')`,
      monthToDate: sql<number>`count(*) filter (where ${newsProviderRequests.createdAt} >= ${monthStart})`,
      failures30d: sql<number>`count(*) filter (where ${newsProviderRequests.createdAt} >= now() - interval '30 days' and not ${newsProviderRequests.ok})`,
    })
    .from(newsProviderRequests)
    .where(eq(newsProviderRequests.provider, provider));

  return {
    last24h: Number(row?.last24h ?? 0),
    rolling30d: Number(row?.rolling30d ?? 0),
    monthToDate: Number(row?.monthToDate ?? 0),
    failures30d: Number(row?.failures30d ?? 0),
  };
}

/** Requests made by `provider` since `since`. The number the hard cap is checked against. */
export async function monthToDateRequests(provider: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(newsProviderRequests)
    .where(and(eq(newsProviderRequests.provider, provider), gte(newsProviderRequests.createdAt, since)));
  return row?.n ?? 0;
}

/**
 * Claim the right to send this month's cap notice.
 *
 * A conditional UPDATE, so exactly one caller wins per month key no matter how
 * many ticks hit the ceiling simultaneously — and the claim expires by itself
 * when the month rolls over.
 */
export async function claimCapNotice(monthKey: string): Promise<boolean> {
  const rows = await db
    .update(newsSettings)
    .set({ capNotifiedMonth: monthKey, updatedAt: new Date() })
    .where(
      and(
        eq(newsSettings.id, SETTINGS_ID),
        or(isNull(newsSettings.capNotifiedMonth), ne(newsSettings.capNotifiedMonth, monthKey)),
      ),
    )
    .returning({ id: newsSettings.id });
  return rows.length > 0;
}

/** Opportunistic retention trim, called from the (infrequent) import job. */
export async function pruneProviderRequests(): Promise<void> {
  await db.delete(newsProviderRequests).where(sql`${newsProviderRequests.createdAt} < now() - interval '90 days'`);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface StatusSnapshot {
  lastImportAt: Date | null;
  /** True when the last import hit the provider's row limit — events may be missing. */
  lastImportTruncated: boolean;
  paused: boolean;
  currencies: string;
  minImpact: Impact;
  totalEvents: number;
  upcoming: EconomicEvent[];
  upcomingCount: number;
  /** Announced but still awaiting a print — i.e. genuinely in flight. */
  awaitingResult: number;
}

export async function statusSnapshot(now: Date = new Date(), limit = 5): Promise<StatusSnapshot> {
  const settings = await getSettings();

  const [totals] = await db.select({ n: count() }).from(economicEvents);

  const upcoming = await db
    .select()
    .from(economicEvents)
    .where(gt(economicEvents.releaseAt, now))
    .orderBy(asc(economicEvents.releaseAt))
    .limit(limit);

  const [upcomingTotal] = await db
    .select({ n: count() })
    .from(economicEvents)
    .where(gt(economicEvents.releaseAt, now));

  const [awaiting] = await db
    .select({ n: count() })
    .from(economicEvents)
    .where(
      and(
        lte(economicEvents.releaseAt, now),
        isNull(economicEvents.actual),
        // Speeches and statements are not "awaiting" anything — counting them
        // would show a number that never falls.
        mayPrintActual,
        hasDelivery('release'),
      ),
    );

  return {
    lastImportAt: settings.lastImportAt,
    lastImportTruncated: settings.lastImportTruncated,
    paused: settings.paused,
    currencies: settings.currencies,
    minImpact: settings.minImpact,
    totalEvents: totals?.n ?? 0,
    upcoming,
    upcomingCount: upcomingTotal?.n ?? 0,
    awaitingResult: awaiting?.n ?? 0,
  };
}
