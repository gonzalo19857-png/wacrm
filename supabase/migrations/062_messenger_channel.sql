-- ============================================================
-- 062_messenger_channel
--
-- Facebook Messenger auto-reply (Marketplace/Page messages) reuses
-- the same `conversations`/`messages` tables as WhatsApp, but the
-- send path needs to know which API a given thread belongs to.
-- `channel` defaults every existing row to 'whatsapp' (the only
-- channel that has ever existed here), so this is purely additive.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('whatsapp', 'messenger'));
