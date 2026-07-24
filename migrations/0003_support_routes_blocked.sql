-- Support reply-routing + broadcast blocker tracking.
-- Idempotent: safe to run repeatedly.

-- Set when a broadcast/DM hits a 403 (user blocked the bot). Cleared on any
-- inbound activity. Blocked users are excluded from future broadcasts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;

-- Maps a forwarded support message (in an admin's chat) back to the user who
-- wrote it, so an admin can answer with a native Telegram reply.
CREATE TABLE IF NOT EXISTS support_routes (
  id               serial PRIMARY KEY,
  admin_chat_id    bigint NOT NULL,
  message_id       bigint NOT NULL,
  telegram_user_id bigint NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS support_routes_chat_msg_unique ON support_routes (admin_chat_id, message_id);
