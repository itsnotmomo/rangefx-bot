-- Raw status from the legacy InviteMember export (lead / customer / churned).
-- Purely informational: no behavioral effect anywhere. Shown in /find and
-- available for future broadcast segmentation.
-- Idempotent: safe to run repeatedly.

ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_status text;
