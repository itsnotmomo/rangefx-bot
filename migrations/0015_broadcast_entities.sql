-- Formatting for broadcasts.
--
-- Telegram delivers an admin's bold / italic / underline / strikethrough /
-- spoiler / links / code / blockquotes as `entities` (or `caption_entities` on a
-- photo) alongside the plain text. Only the text was being stored, so every
-- broadcast arrived unformatted.
--
-- `entities` holds the MessageEntity array verbatim: message.entities for a
-- 'text' broadcast, message.caption_entities for a 'photo' one. Sends pass it
-- back as entities / caption_entities with NO parse_mode, so there is nothing
-- to escape.
--
-- Nullable: existing rows read as NULL = no formatting and send as before.
--
-- Idempotent: safe to run repeatedly.

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS entities jsonb;
