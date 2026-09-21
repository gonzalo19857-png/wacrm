-- ============================================================
-- 060_studio_brand_references.sql
--
-- Feeds the account's own approved AI-generated photos back into
-- future generations as style reference images (see
-- src/lib/studio/gemini-image.ts) so the brand look compounds over
-- time instead of every generation starting from a blank slate —
-- the "publicist that learns from what you approve" loop.
--
-- studio_posts.media_prompt records the prompt that produced a
-- generated photo, so it can travel with the image into
-- studio_brand_references once the post is approved (see
-- src/lib/studio/brand-references.ts).
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE studio_posts ADD COLUMN IF NOT EXISTS media_prompt text;

CREATE TABLE IF NOT EXISTS studio_brand_references (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  post_id    uuid REFERENCES studio_posts(id) ON DELETE SET NULL,
  image_url  text NOT NULL,
  prompt     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_brand_references_account_idx
  ON studio_brand_references (account_id, created_at DESC);

ALTER TABLE studio_brand_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_brand_references_select ON studio_brand_references;
CREATE POLICY studio_brand_references_select ON studio_brand_references FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS studio_brand_references_insert ON studio_brand_references;
CREATE POLICY studio_brand_references_insert ON studio_brand_references FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS studio_brand_references_delete ON studio_brand_references;
CREATE POLICY studio_brand_references_delete ON studio_brand_references FOR DELETE
  USING (is_account_member(account_id, 'agent'));
