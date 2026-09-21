-- ============================================================
-- 061_studio_ads.sql
--
-- Studio's ad creator — actually creates Campaign -> Ad Set -> Ad
-- Creative -> Ad on Meta's Marketing API (a different product from the
-- organic Page/Instagram publishing in 055/056). Reuses the same
-- studio_meta_connections row and long-lived user token; just needs
-- that token to also carry the ads_management scope (see
-- docs/studio-meta-setup.md) and an ad account id, added here.
--
-- Safety: every ad this app creates lands in Meta with status=PAUSED
-- at every level (campaign/adset/ad) — see src/lib/studio/meta-ads.ts.
-- Nothing spends until an admin explicitly activates it, so writes to
-- studio_ads are gated at 'admin' same as the connection itself.
--
-- v1 scope (owner's own choice): OUTCOME_TRAFFIC objective only (a
-- single link-click ad — works for a wa.me WhatsApp link, a website, a
-- catalog page, whatever the owner wants), one ad account, no
-- multi-account picker. Broader objectives/formats are a later phase.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE studio_meta_connections
  ADD COLUMN IF NOT EXISTS ad_account_id       text,
  ADD COLUMN IF NOT EXISTS ad_account_name     text,
  ADD COLUMN IF NOT EXISTS ad_account_currency text;

CREATE TABLE IF NOT EXISTS studio_ads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  objective         text NOT NULL DEFAULT 'OUTCOME_TRAFFIC',
  daily_budget      numeric NOT NULL,
  currency          text NOT NULL,
  country           text NOT NULL,
  age_min           integer NOT NULL,
  age_max           integer NOT NULL,
  gender            text NOT NULL DEFAULT 'all' CHECK (gender IN ('all', 'male', 'female')),
  message           text NOT NULL,
  headline          text NOT NULL,
  link_url          text NOT NULL,
  image_url         text NOT NULL,
  call_to_action    text NOT NULL,
  status            text NOT NULL DEFAULT 'paused' CHECK (status IN ('paused', 'active', 'error')),
  error_detail      text,
  meta_campaign_id  text,
  meta_adset_id     text,
  meta_creative_id  text,
  meta_ad_id        text,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_ads_account_idx ON studio_ads (account_id, created_at DESC);

ALTER TABLE studio_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_ads_select ON studio_ads;
CREATE POLICY studio_ads_select ON studio_ads FOR SELECT
  USING (is_account_member(account_id));

-- Write access is admin-only, like studio_meta_connections — these rows
-- represent real ad spend, not just draft content.
DROP POLICY IF EXISTS studio_ads_insert ON studio_ads;
CREATE POLICY studio_ads_insert ON studio_ads FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS studio_ads_update ON studio_ads;
CREATE POLICY studio_ads_update ON studio_ads FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS studio_ads_delete ON studio_ads;
CREATE POLICY studio_ads_delete ON studio_ads FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_studio_ads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_ads_updated_at ON studio_ads;
CREATE TRIGGER studio_ads_updated_at
  BEFORE UPDATE ON studio_ads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_studio_ads_updated_at();
