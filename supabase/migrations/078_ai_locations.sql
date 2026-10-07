-- ============================================================
-- 078_ai_locations.sql
--
-- Real WhatsApp location pins the AI auto-reply bot can send, keyed by
-- an arbitrary business-defined string (e.g. "taller"). Mirrors
-- ai_product_images (migration 042) but for `[[LOCATION:<key>]]`
-- sentinels (see defaults.ts) instead of `[[IMAGE:<key>]]` — a pin
-- needs lat/lng + name/address, not a media URL, so it can't reuse
-- that table.
--
-- RLS mirrors ai_product_images: any member reads, admin+ writes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text,
  address     text,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS ai_locations_account_id_idx
  ON ai_locations (account_id);

ALTER TABLE ai_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_locations_select ON ai_locations;
CREATE POLICY ai_locations_select ON ai_locations FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_locations_insert ON ai_locations;
CREATE POLICY ai_locations_insert ON ai_locations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_locations_update ON ai_locations;
CREATE POLICY ai_locations_update ON ai_locations FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_locations_delete ON ai_locations;
CREATE POLICY ai_locations_delete ON ai_locations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_locations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_locations_updated_at ON ai_locations;
CREATE TRIGGER ai_locations_updated_at
  BEFORE UPDATE ON ai_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_locations_updated_at();
