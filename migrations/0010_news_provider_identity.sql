-- Provider identity and informational fields for calendar events.
--
-- Why these columns exist
-- -----------------------
-- RapidAPI rows carry two UUIDs, `id` and `eventId`, and it is NOT established
-- whether `eventId` identifies a single occurrence or the whole recurring
-- series. If it is per-series, then every recurring release — jobless claims,
-- the PMIs — would collide on (provider, provider_event_id) and each week would
-- silently overwrite the last.
--
-- The adapter therefore composes provider_event_id as `eventId:YYYY-MM-DD`
-- using the UTC calendar date of dateUtc, which is correct under EITHER
-- interpretation. The date is used rather than the full timestamp so that a
-- minor revision to the release time updates the existing row instead of
-- creating a duplicate.
--
-- The raw identifiers are preserved here so the ambiguity can be settled from
-- real data later: if `id` turns out to be unique per occurrence, these columns
-- are the evidence, and no history has been lost in the meantime.
--
-- Everything below is INFORMATIONAL. Nothing here is read by the renderer —
-- the deviation line stays ours to compute from actual and forecast.
--
-- Idempotent: safe to run repeatedly.

-- Raw provider identifiers, kept verbatim.
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS provider_row_id text;
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS provider_series_id text;

-- Provider-supplied metrics and reference-period descriptors. Stored as text
-- for the same reason the readings are: round-trip the vendor's value verbatim
-- and never interpret it at write time.
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS potency text;
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS ratio_deviation text;
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS period_date_utc timestamptz;
ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS period_type text;

-- Lets us answer "does one eventId span several release dates?" directly, which
-- is exactly the question the composite key is defending against.
CREATE INDEX IF NOT EXISTS economic_events_series_idx
  ON economic_events (provider, provider_series_id);
