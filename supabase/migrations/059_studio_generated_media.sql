-- ============================================================
-- 059_studio_generated_media.sql
--
-- Adds 'generated' (Gemini image generation) as a third
-- studio_posts.media_source alongside 'product' and 'upload' —
-- see 058_studio_ai_settings.sql for the Gemini key this feeds.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE studio_posts DROP CONSTRAINT IF EXISTS studio_posts_media_source_check;
ALTER TABLE studio_posts ADD CONSTRAINT studio_posts_media_source_check
  CHECK (media_source IN ('product', 'upload', 'generated'));
