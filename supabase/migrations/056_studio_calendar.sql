-- ============================================================
-- 056_studio_calendar.sql
--
-- Studio's content calendar: the AI proposes a month's worth of posts
-- (studio_campaigns groups them, studio_posts is each individual post),
-- the owner reviews/edits/approves each one, and only rows with
-- status='approved' AND a past publish_at get picked up by the
-- publish cron (migration 057 adds the storage bucket; the cron route
-- itself lands in a later change).
--
-- v1 scope (owner's own choice): photo/text posts only — no
-- video/Reels/Stories (the Graph API needs async upload-status
-- polling for video, deferred to a later phase). One connected Page +
-- Instagram account per account (migration 055), so no per-post page
-- picker.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS studio_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month            date NOT NULL,   -- first-of-month, e.g. 2026-10-01
  title            text,
  generation_notes text,            -- the brief the owner typed
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_campaigns_account_month_idx ON studio_campaigns (account_id, month);

ALTER TABLE studio_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_campaigns_select ON studio_campaigns;
CREATE POLICY studio_campaigns_select ON studio_campaigns FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS studio_campaigns_insert ON studio_campaigns;
CREATE POLICY studio_campaigns_insert ON studio_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS studio_campaigns_update ON studio_campaigns;
CREATE POLICY studio_campaigns_update ON studio_campaigns FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS studio_campaigns_delete ON studio_campaigns;
CREATE POLICY studio_campaigns_delete ON studio_campaigns FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_studio_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_campaigns_updated_at ON studio_campaigns;
CREATE TRIGGER studio_campaigns_updated_at
  BEFORE UPDATE ON studio_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_studio_campaigns_updated_at();

CREATE TABLE IF NOT EXISTS studio_posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id    uuid NOT NULL REFERENCES studio_campaigns(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  scheduled_time time NOT NULL DEFAULT '10:00',
  publish_at     timestamptz,     -- set on approve (client-local time -> UTC); cron filters on this
  platform       text NOT NULL CHECK (platform IN ('facebook','instagram')),
  format         text NOT NULL CHECK (format IN ('photo','text')),   -- video/reels: later phase
  idea           text NOT NULL,
  caption        text NOT NULL,
  hashtags       text[],
  media_source   text CHECK (media_source IN ('product','upload')),
  product_id     uuid REFERENCES products(id) ON DELETE SET NULL,
  media_url      text,
  status         text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','publishing','published','failed','skipped')),
  meta_post_id   text,
  error_detail   text,
  approved_by    uuid REFERENCES auth.users(id),
  approved_at    timestamptz,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_posts_campaign_idx ON studio_posts (campaign_id);
-- Partial index matching exactly what the publish cron filters on.
CREATE INDEX IF NOT EXISTS studio_posts_due_idx ON studio_posts (publish_at) WHERE status = 'approved';

ALTER TABLE studio_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_posts_select ON studio_posts;
CREATE POLICY studio_posts_select ON studio_posts FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS studio_posts_insert ON studio_posts;
CREATE POLICY studio_posts_insert ON studio_posts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS studio_posts_update ON studio_posts;
CREATE POLICY studio_posts_update ON studio_posts FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS studio_posts_delete ON studio_posts;
CREATE POLICY studio_posts_delete ON studio_posts FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_studio_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_posts_updated_at ON studio_posts;
CREATE TRIGGER studio_posts_updated_at
  BEFORE UPDATE ON studio_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_studio_posts_updated_at();
