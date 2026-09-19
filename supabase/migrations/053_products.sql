-- ============================================================
-- 053_products.sql
--
-- Product catalog — until now the account had no structured place to
-- keep what it sells: a product's name/price/photo lived either typed
-- into the free-text AI system prompt, or as a bare `key -> image_url`
-- row in `ai_product_images` with no name or price at all. Neither is
-- editable without knowing where to look.
--
-- This table is the single place to manage a product (name, price,
-- short description, photo). A later migration will teach the AI
-- system prompt to read from this table automatically instead of
-- requiring price/product text to be hand-typed into the prompt.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  price       numeric(12,2) NOT NULL DEFAULT 0,
  currency    text NOT NULL DEFAULT 'USD',
  image_url   text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_account_id_idx ON products (account_id);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS products_insert ON products;
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS products_update ON products;
CREATE POLICY products_update ON products FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS products_delete ON products;
CREATE POLICY products_delete ON products FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_products_updated_at();

-- Storage bucket for product photos — mirrors 008's avatars bucket,
-- but keyed by account (path: product-images/{account_id}/<file>) so
-- every agent on the account can manage the catalog's photos, not just
-- whoever uploaded them.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  TRUE,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Product images are publicly readable" ON storage.objects;
CREATE POLICY "Product images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Account agents can upload product images" ON storage.objects;
CREATE POLICY "Account agents can upload product images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-images'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Account agents can update product images" ON storage.objects;
CREATE POLICY "Account agents can update product images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'product-images'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );

DROP POLICY IF EXISTS "Account agents can delete product images" ON storage.objects;
CREATE POLICY "Account agents can delete product images"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-images'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'agent')
  );
