-- Truncation flag for the last calendar import.
--
-- A provider that returns exactly its row limit has stopped counting, not run
-- out of calendar — the window was cut short and events were dropped. At read
-- time a truncated import is indistinguishable from a quiet one, so the import
-- records the fact here and /news_status shows it. Silent truncation is the one
-- failure this design cannot tolerate.
--
-- Idempotent: safe to run repeatedly.

ALTER TABLE news_settings
  ADD COLUMN IF NOT EXISTS last_import_truncated boolean NOT NULL DEFAULT false;
