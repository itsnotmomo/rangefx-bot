-- Event classification flags from the provider.
--
-- Three behaviours depend on these, all learned from a live response:
--
--   is_tentative / is_all_day
--     The release time is NOT fixed. BoJ announcements carry a plausible
--     03:00 that is only an estimate, so a T-5 notice and a "Releasing now"
--     fired off that timestamp are simply wrong. These events get no
--     scheduled posts at all; they are announced once the actual exists.
--
--   is_speech / is_report
--     FOMC statements, press conferences, the BoE Monetary Policy Summary.
--     These never print a number, so polling for a result burns quota
--     forever and the release post would sit unresolved indefinitely.
--
-- NOT NULL DEFAULT false: a row where the provider omits the flag is treated
-- as an ordinary scheduled numeric event, which is the pre-existing behaviour
-- and therefore never a regression.
--
-- Idempotent: safe to run repeatedly.

ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS is_tentative boolean NOT NULL DEFAULT false;
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS is_all_day   boolean NOT NULL DEFAULT false;
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS is_speech    boolean NOT NULL DEFAULT false;
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS is_report    boolean NOT NULL DEFAULT false;
