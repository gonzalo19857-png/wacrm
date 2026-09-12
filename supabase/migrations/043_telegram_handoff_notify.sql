-- ============================================================
-- TELEGRAM HANDOFF NOTIFICATIONS
--
-- Optional per-account Telegram alert fired the moment the AI
-- auto-reply bot hands a conversation off to a human (the same
-- branch that sets `ai_autoreply_disabled` / `ai_handoff_summary` in
-- src/lib/ai/auto-reply.ts). Lives on `ai_configs` rather than a new
-- table since it's config for that exact handoff event, not a
-- general-purpose notification system.
--
-- `telegram_bot_token` is encrypted at rest with the same AES-256-GCM
-- helper as `api_key` / `embeddings_api_key` (src/lib/whatsapp/encryption.ts).
-- `telegram_chat_id` is not a secret (it identifies a chat, not a
-- credential) and is stored/read in the clear.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT,
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_notify_on_handoff BOOLEAN NOT NULL DEFAULT false;
