-- ============================================================
-- 047_telegram_notify_on_sale.sql
--
-- Extends the existing Telegram alert (migration 043, "needs a human")
-- to a second, independently-toggled event: a new sale being
-- registered (migration 045's sale-tag flow). Reuses the same bot
-- token + chat id already configured for handoff alerts — no new
-- credentials — but as its own boolean so an account can run one
-- without the other.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS telegram_notify_on_sale boolean NOT NULL DEFAULT false;
