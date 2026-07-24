-- Rename the funnel's start timestamp to first_started_at: the basis for
-- new-vs-returning /start notifications. Null for legacy-imported rows (they
-- have a row but never truly started this bot); set on the first real /start.
-- Idempotent: the rename only fires if the old column still exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'started_at'
  ) THEN
    ALTER TABLE users RENAME COLUMN started_at TO first_started_at;
  END IF;
END $$;

-- Safety net for databases that never had either column.
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_started_at timestamptz;
