-- ============================================================
-- 054_product_media.sql
--
-- Extra photos and videos per product, beyond the single generic
-- `products.image_url` (which is often just a marketing/infographic
-- shot, not a real "in the wild" photo of the product). Lets the
-- account attach a gallery — e.g. a few real installation photos, a
-- short demo video — that a later feature can pull from when a
-- customer specifically asks to see more.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('image', 'video')),
  url         text NOT NULL,
  caption     text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_media_product_id_idx ON product_media (product_id);
CREATE INDEX IF NOT EXISTS product_media_account_id_idx ON product_media (account_id);

ALTER TABLE product_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_media_select ON product_media;
CREATE POLICY product_media_select ON product_media FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS product_media_insert ON product_media;
CREATE POLICY product_media_insert ON product_media FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS product_media_delete ON product_media;
CREATE POLICY product_media_delete ON product_media FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Storage bucket for extra product photos/videos — mirrors 053's
-- product-images bucket, but sized for video (WhatsApp's Cloud API
-- caps outbound video at 16 MB) and keyed the same way
-- (product-media/{account_id}/<file>).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-media',
  'product-media',
  TRUE,
  16777216, -- 16 MB — WhatsApp Cloud API's outbound video cap
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/3gpp', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Product media is publicly readable" ON storage.objects;
CREATE POLICY "Product media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-media');

DROP POLICY IF EXISTS "Account agents can upload product media" ON storage.objects;
CREATE POLICY "Account agents can upload product media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-media'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Account agents can delete product media" ON storage.objects;
CREATE POLICY "Account agents can delete product media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-media'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );
