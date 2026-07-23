-- Funnel tracking, acquisition attribution, and the lead follow-up engine.
-- Idempotent: safe to run repeatedly.

-- Funnel timestamps: each records the FIRST time the user hit that stage.
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_source text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS viewed_plans_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS opened_checkout_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Scheduled follow-up touches for users who entered the funnel but didn't pay.
-- At most one row per (user, stage); stage 1 = +1h, stage 2 = +24h. A user who
-- pays has their unsent rows deleted — two touches maximum, ever.
CREATE TABLE IF NOT EXISTS followups (
  id               serial PRIMARY KEY,
  telegram_user_id bigint NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  stage            integer NOT NULL,
  scheduled_at     timestamptz NOT NULL,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS followups_user_stage_unique ON followups (telegram_user_id, stage);
CREATE INDEX IF NOT EXISTS followups_due_idx ON followups (scheduled_at) WHERE sent_at IS NULL;
