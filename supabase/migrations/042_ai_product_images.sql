-- ============================================================
-- 042_ai_product_images.sql
--
-- Product images the AI auto-reply bot can attach to a reply, keyed by
-- an arbitrary business-defined string (e.g. "sedan-l"). Distinct from
-- the knowledge-base document image added in migration 041: that one
-- is selected by RAG (whatever text best matches the customer's
-- message), which works for picking a product *category* but can't
-- pick a specific *variant* within it — e.g. a recommended talla is
-- something the model derives, never text the customer typed, so no
-- amount of retrieval tuning can select "the L-size photo" over "the
-- M-size photo" from the customer's message alone.
--
-- This table instead lets the model name the exact image it wants via
-- a `[[IMAGE:<key>]]` sentinel in its reply (see defaults.ts) — the
-- same pattern as the existing `[[HANDOFF]]` sentinel. The account's
-- own system prompt is responsible for telling the model which keys
-- exist for its own catalog; this table just resolves key -> URL.
--
-- RLS mirrors ai_knowledge_documents: any member reads, admin+ writes.
-- The auto-reply bot resolves the sentinel under the service-role
-- client, same as everywhere else in this module.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key         text NOT NULL,
  image_url   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS ai_product_images_account_id_idx
  ON ai_product_images (account_id);

ALTER TABLE ai_product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_product_images_select ON ai_product_images;
CREATE POLICY ai_product_images_select ON ai_product_images FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_product_images_insert ON ai_product_images;
CREATE POLICY ai_product_images_insert ON ai_product_images FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_product_images_update ON ai_product_images;
CREATE POLICY ai_product_images_update ON ai_product_images FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_product_images_delete ON ai_product_images;
CREATE POLICY ai_product_images_delete ON ai_product_images FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_product_images_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_product_images_updated_at ON ai_product_images;
CREATE TRIGGER ai_product_images_updated_at
  BEFORE UPDATE ON ai_product_images
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_product_images_updated_at();
