-- ============================================================
-- 072_meta_conversions_page_id.sql
--
-- Companion to 071_contacts_ctwa_clid.sql. Meta's Conversions API also
-- hard-requires `page_id` (the Facebook Page connected to the
-- WhatsApp number) in `user_data` for `business_messaging` events —
-- confirmed the same way, by reproducing the live rejection directly
-- against the Graph API (error_subcode 2804069, "Falta el
-- identificador de la página"). Unlike `ctwa_clid` this value is
-- static per account (one Page per WhatsApp number), so it belongs
-- next to `dataset_id` in the account's Conversions API config rather
-- than per-contact.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE meta_conversions_configs ADD COLUMN IF NOT EXISTS page_id text;
