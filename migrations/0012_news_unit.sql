-- Unit of measurement for an event's readings.
--
-- The provider sends the number and its unit separately: consensus 1 with
-- unit "%" is one percent, but rendered without the unit it read as a bare
-- "1" in the topic — a number that means nothing on its own and is easily
-- misread by an order of magnitude.
--
-- Stored verbatim, like the readings themselves. Whether it is appended is a
-- rendering decision, made where the message is built.
--
-- Idempotent: safe to run repeatedly.

ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS unit text;
