-- ============================================================
-- 065_studio_ads_whatsapp.sql
--
-- Click-to-WhatsApp ads for Studio's ad creator, alongside the
-- existing link-click (OUTCOME_TRAFFIC) format from 061. A
-- Click-to-WhatsApp ad has no destination link of its own — Meta
-- resolves the WhatsApp number from the Page's own connection — so
-- link_url stops being mandatory.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE studio_ads
  ALTER COLUMN link_url DROP NOT NULL;

ALTER TABLE studio_ads
  ADD COLUMN IF NOT EXISTS destination_type text NOT NULL DEFAULT 'link'
    CHECK (destination_type IN ('link', 'whatsapp'));
