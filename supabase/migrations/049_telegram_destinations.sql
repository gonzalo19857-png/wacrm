-- ============================================================
-- 049_telegram_destinations.sql
--
-- Replaces the single bot-token/chat-id pair on `ai_configs`
-- (migrations 043 + 047) with a proper multi-destination table: an
-- account can now register several Telegram bots, each one
-- subscribed to a specific event. E.g. a generic "needs a human" bot
-- in one chat, plus a separate bot just for orders shipping to Lima
-- and another just for Provincia, each read by a different team.
--
-- `event_key` is a small fixed enum for now (the four events the
-- product currently knows how to detect) rather than a free-text
-- column — a typo'd key would silently mean "never fires," which is
-- worse than a CHECK constraint rejecting it at save time. Multiple
-- rows may share the same event_key (fan-out to every active one).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_destinations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label       text NOT NULL,
  bot_token   text NOT NULL,   -- AES-256-GCM-encrypted, same as ai_configs.api_key
  chat_id     text NOT NULL,
  event_key   text NOT NULL CHECK (
    event_key IN ('needs_human', 'new_sale', 'handoff_lima', 'handoff_provincia')
  ),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_destinations_account_idx
  ON telegram_destinations (account_id);
CREATE INDEX IF NOT EXISTS telegram_destinations_event_idx
  ON telegram_destinations (account_id, event_key);

ALTER TABLE telegram_destinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_destinations_select ON telegram_destinations;
CREATE POLICY telegram_destinations_select ON telegram_destinations FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS telegram_destinations_insert ON telegram_destinations;
CREATE POLICY telegram_destinations_insert ON telegram_destinations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS telegram_destinations_update ON telegram_destinations;
CREATE POLICY telegram_destinations_update ON telegram_destinations FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS telegram_destinations_delete ON telegram_destinations;
CREATE POLICY telegram_destinations_delete ON telegram_destinations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_telegram_destinations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telegram_destinations_updated_at ON telegram_destinations;
CREATE TRIGGER telegram_destinations_updated_at
  BEFORE UPDATE ON telegram_destinations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_telegram_destinations_updated_at();

-- Superseded by the table above — no account has both a token and a
-- chat id set yet (verified on the one live deployment before writing
-- this), so there is nothing to backfill.
ALTER TABLE ai_configs
  DROP COLUMN IF EXISTS telegram_bot_token,
  DROP COLUMN IF EXISTS telegram_chat_id,
  DROP COLUMN IF EXISTS telegram_notify_on_handoff,
  DROP COLUMN IF EXISTS telegram_notify_on_sale;
