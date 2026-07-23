-- Range Compound bot — initial schema.
-- Idempotent: safe to run repeatedly (CREATE TABLE / INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS users (
  telegram_user_id   bigint PRIMARY KEY,
  telegram_username  text,
  first_name         text,
  email              text,
  stripe_customer_id text,
  source             text NOT NULL DEFAULT 'bot',
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_stripe_customer_idx ON users (stripe_customer_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     serial PRIMARY KEY,
  telegram_user_id       bigint NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  stripe_subscription_id text,
  stripe_price_id        text,
  plan                   text,
  status                 text NOT NULL,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_sub_unique ON subscriptions (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (telegram_user_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);

CREATE TABLE IF NOT EXISTS access_grants (
  id               serial PRIMARY KEY,
  telegram_user_id bigint NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  resource_type    text NOT NULL,
  resource_id      text NOT NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  reason           text
);
CREATE INDEX IF NOT EXISTS access_grants_user_resource_idx ON access_grants (telegram_user_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS access_grants_live_idx ON access_grants (resource_type, revoked_at);

CREATE TABLE IF NOT EXISTS events (
  id               serial PRIMARY KEY,
  stripe_event_id  text,
  type             text NOT NULL,
  telegram_user_id bigint,
  payload          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS events_stripe_event_unique ON events (stripe_event_id);
CREATE INDEX IF NOT EXISTS events_type_idx ON events (type);
