-- Hard monthly request cap for paid calendar providers.
--
-- The ledger in 0007 counts requests; this column is what makes the cap fire
-- exactly once. It holds the 'YYYY-MM' (UTC) in which the admin was already
-- told the cap was hit, so a per-minute job that keeps hitting the ceiling
-- sends one DM for the month rather than one per attempt. It resets by itself
-- when the month key changes.
--
-- Idempotent: safe to run repeatedly.

ALTER TABLE news_settings ADD COLUMN IF NOT EXISTS cap_notified_month text;
