-- Economic calendar news module.
--
-- Fully additive: nothing here touches users, subscriptions, access_grants,
-- events, followups or support_routes. Idempotent — safe to run repeatedly.

-- Calendar events, one row per (provider, provider_event_id).
-- Numeric readings are stored as TEXT on purpose: providers emit "145K",
-- "3.2%", "-0.4" and we must round-trip them verbatim. Interpretation happens
-- at render time, never at write time.
CREATE TABLE IF NOT EXISTS economic_events (
  id                 serial PRIMARY KEY,
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,
  currency           text NOT NULL,
  title              text NOT NULL,
  impact             text NOT NULL,
  -- Always a true UTC instant. Providers that emit offset-less local strings
  -- are normalised in their adapter before we ever reach this column.
  release_at         timestamptz NOT NULL,
  previous           text,
  forecast           text,
  actual             text,
  revised            text,
  actual_received_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The upsert key for the hourly import.
CREATE UNIQUE INDEX IF NOT EXISTS economic_events_provider_event_unique
  ON economic_events (provider, provider_event_id);

-- Drives every job's "what is due" scan.
CREATE INDEX IF NOT EXISTS economic_events_release_idx
  ON economic_events (release_at);

-- One row per message this module has put into the topic.
--
-- The UNIQUE (event_id, kind) index IS the dedup guarantee: a job claims its
-- slot by inserting here BEFORE sending, so a duplicate cron tick, a retry, or
-- two processes racing can never double-post the same stage of the same event.
CREATE TABLE IF NOT EXISTS news_deliveries (
  id                  serial PRIMARY KEY,
  event_id            integer NOT NULL REFERENCES economic_events (id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('pre_5m', 'release', 'result')),
  -- Null between claiming the slot and Telegram confirming the send. The
  -- release row's id is what the result poll later edits in place.
  telegram_message_id bigint,
  sent_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS news_deliveries_event_kind_unique
  ON news_deliveries (event_id, kind);

CREATE INDEX IF NOT EXISTS news_deliveries_event_idx
  ON news_deliveries (event_id);

-- Runtime settings. Exactly one row, enforced by the CHECK on the primary key.
-- Null quiet hours fall back to NEWS_QUIET_START / NEWS_QUIET_END.
CREATE TABLE IF NOT EXISTS news_settings (
  id          integer PRIMARY KEY DEFAULT 1,
  currencies  text NOT NULL DEFAULT 'USD,EUR,JPY',
  min_impact  text NOT NULL DEFAULT 'high',
  quiet_start text,
  quiet_end   text,
  paused      boolean NOT NULL DEFAULT false,
  -- Stamped by the import job on every successful run; surfaced in /news_status
  -- so a silently failing import is visible as a stale timestamp.
  last_import_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_settings_singleton CHECK (id = 1)
);

INSERT INTO news_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- One row per outbound request to a paid provider API.
--
-- Exists so quota consumption is visible in /news_status BEFORE a plan limit is
-- hit, rather than discovered as mysterious empty responses. Volume is tiny
-- (a few hundred rows a month at default cadences); rows older than 90 days
-- are pruned opportunistically by the import job.
CREATE TABLE IF NOT EXISTS news_provider_requests (
  id         serial PRIMARY KEY,
  provider   text NOT NULL,
  -- 'calendar' | 'result' — which call shape consumed the quota.
  endpoint   text NOT NULL,
  ok         boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_provider_requests_provider_time_idx
  ON news_provider_requests (provider, created_at);
