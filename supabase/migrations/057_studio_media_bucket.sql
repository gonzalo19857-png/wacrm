-- ============================================================
-- 057_studio_media_bucket.sql
--
-- Storage bucket for photos the owner uploads directly to a calendar
-- post (as opposed to reusing an existing product photo from the
-- catalog). Mirrors 053_products.sql's product-images bucket, keyed
-- by account: path studio-media/{account_id}/<file>.
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'studio-media',
  'studio-media',
  TRUE,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Studio media are publicly readable" ON storage.objects;
CREATE POLICY "Studio media are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'studio-media');

DROP POLICY IF EXISTS "Account agents can upload studio media" ON storage.objects;
CREATE POLICY "Account agents can upload studio media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'studio-media'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Account agents can update studio media" ON storage.objects;
CREATE POLICY "Account agents can update studio media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'studio-media'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Account agents can delete studio media" ON storage.objects;
CREATE POLICY "Account agents can delete studio media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'studio-media'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );
