-- Affiliate attribution from the legacy InviteMember export
-- (referredByAffiliateId). Purely informational: no behavioral effect
-- anywhere. Shown in /find when present.
-- Idempotent: safe to run repeatedly.

ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_affiliate_id text;
