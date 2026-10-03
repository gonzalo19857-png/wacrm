-- ============================================================
-- 076_contacts_ad_campaign_line.sql
--
-- Replaces keyword-only LED-vs-cobertor detection (a customer's
-- message has to literally say "led"/"foco"/etc. — see
-- `LED_SIGNAL_REGEX` in src/lib/ai/query.ts) with a precise signal
-- straight from the Meta ad that brought the contact in: the webhook
-- already receives `message.referral.source_id` (the ad's id) on the
-- first inbound message of a click-to-WhatsApp conversation, right
-- alongside `ctwa_clid` (migration 071). That ad id is resolved once,
-- first-touch, to its campaign via the Marketing API (same
-- `studio_meta_connections` token Studio's ad tools already use) and
-- classified by the campaign's own name — GMVA's real ad account
-- already names every campaign unambiguously ("Cobertores main",
-- "Focos LED general", "PANELES LED 2", "EXPLORADORAS LED", etc.), so
-- no manual per-campaign mapping is needed and a brand-new campaign
-- is classified correctly from the moment it's named.
--
-- `ad_campaign_id` is kept too (not strictly required for routing)
-- since it's the concrete thing being "recognized" and is useful on
-- its own for any future per-campaign reporting.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ad_campaign_id text,
  ADD COLUMN IF NOT EXISTS ad_product_line text CHECK (ad_product_line IN ('led', 'cobertor'));
