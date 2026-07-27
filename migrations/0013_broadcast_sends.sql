-- Durable broadcast delivery tracking.
--
-- The incident this exists to prevent: a /broadcast to 11,408 recipients was
-- awaited inside the Telegram webhook handler. grammY's webhookCallback
-- defaults to timeoutMilliseconds 10_000 with onTimeout "throw", so at exactly
-- ten seconds it rejected. Express 4 discards rejected middleware promises, no
-- process-level handler existed, and Node terminated the process. Roughly 270
-- of 11,408 recipients had been reached, and nothing recorded which ones — the
-- progress counter lived only in memory and died with the process.
--
-- Two tables:
--
--   broadcasts        One row per confirmed send. `idempotency_key` is UNIQUE
--                     and derived from the confirming Telegram update id, so a
--                     webhook retry of that same confirmation collides on the
--                     index instead of starting a second run. In-memory flow
--                     state cannot provide this guarantee — it is empty after a
--                     restart, which is exactly when a retry arrives.
--
--   broadcast_sends   The audience snapshot, captured ONCE at enqueue time.
--                     Resume reads this table and never re-runs the audience
--                     query: the runner writes users.blocked_at as it goes and
--                     every audience predicate excludes blocked users, so the
--                     same query returns a smaller row set partway through a
--                     run. Snapshotting is what makes the recipient set stable.
--
-- Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS broadcasts (
  id              serial PRIMARY KEY,
  -- 'all' | 'leads' | 'churned' | 'active' — the audience key as confirmed.
  audience        text NOT NULL,
  -- 'text' | 'photo'.
  kind            text NOT NULL,
  -- JSON payload: {"text":...} or {"photoFileId":...,"caption":...}. Stored so
  -- a resume after a restart can rebuild the exact message without the admin
  -- re-sending it (in-memory draft state does not survive a crash).
  content         text NOT NULL,
  -- 'running' | 'completed' | 'interrupted' | 'cancelled'.
  status          text NOT NULL DEFAULT 'running',
  total           integer NOT NULL DEFAULT 0,
  created_by      bigint,
  -- Unique per confirming update; NULL is allowed and never collides.
  idempotency_key text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS broadcasts_idempotency_key_unique
  ON broadcasts (idempotency_key);
CREATE INDEX IF NOT EXISTS broadcasts_status_idx ON broadcasts (status);

CREATE TABLE IF NOT EXISTS broadcast_sends (
  id               serial PRIMARY KEY,
  broadcast_id     integer NOT NULL REFERENCES broadcasts (id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  -- 'pending' | 'sent' | 'failed'.
  status           text NOT NULL DEFAULT 'pending',
  -- Telegram error_code (403, 400, 429, ...); NULL unless status = 'failed'.
  error_code       integer,
  -- Telegram's description, for the grouped failure summary.
  error            text,
  sent_at          timestamptz
);
-- One row per recipient per broadcast. Also makes the snapshot insert
-- re-runnable: ON CONFLICT DO NOTHING against this index.
CREATE UNIQUE INDEX IF NOT EXISTS broadcast_sends_unique
  ON broadcast_sends (broadcast_id, telegram_user_id);
-- The claim query: pending rows for one broadcast, in stable id order.
CREATE INDEX IF NOT EXISTS broadcast_sends_claim_idx
  ON broadcast_sends (broadcast_id, status, telegram_user_id);
