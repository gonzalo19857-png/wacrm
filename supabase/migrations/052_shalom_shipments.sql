-- ============================================================
-- 052_shalom_shipments.sql
--
-- Automates steps 2-5 of the "cierre de venta" flow described by the
-- business (register sale → confirm product → capture delivery data
-- → send the Shalom receipt → notify on arrival / answer status),
-- for both Provincia (shipped via Shalom) and Lima (hand-delivered)
-- orders.
--
--   1. shalom_agencies — admin-managed reference data: which Shalom
--      agencies exist in which city, with their address. Replaces the
--      manual "screenshot every available agency" step (045's
--      region-tag idea, taken further): the AI auto-reply bot reads
--      this table (never its own training knowledge — agency
--      listings change and a wrong address sent automatically is a
--      real business risk) to list real options the moment a
--      customer names a Provincia city, and asks which one to use.
--
--   2. shipments — one delivery record per order, holding whatever
--      the bot (or an agent) has collected so far: region, the chosen
--      agency (Provincia) or address (Lima), and the recipient's
--      name/DNI/phone. `status` tracks it from data-collection through
--      hand-off to Shalom/courier through delivery, so an agent can
--      notify the customer with one click and the bot can answer
--      "¿ya llegó mi pedido?" without a human.
--
--   3. telegram_destinations.event_key gains 'shipment_ready' — a
--      dedicated alert the moment a shipment has everything it needs
--      to actually be shipped, so whoever packs orders doesn't have
--      to keep checking the CRM for new delivery data.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- 1. Shalom agency directory ------------------------------------

CREATE TABLE IF NOT EXISTS shalom_agencies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Matched case/accent-insensitively against what the customer types
  -- (see src/lib/ai/shalom-agencies.ts) — keep it the plain city name
  -- ("Arequipa"), not "Arequipa - Cercado" or similar.
  city        text NOT NULL,
  name        text NOT NULL,
  address     text NOT NULL,
  reference   text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shalom_agencies_account_id_idx
  ON shalom_agencies (account_id);
CREATE INDEX IF NOT EXISTS shalom_agencies_account_city_idx
  ON shalom_agencies (account_id, city);

ALTER TABLE shalom_agencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shalom_agencies_select ON shalom_agencies;
CREATE POLICY shalom_agencies_select ON shalom_agencies FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shalom_agencies_insert ON shalom_agencies;
CREATE POLICY shalom_agencies_insert ON shalom_agencies FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shalom_agencies_update ON shalom_agencies;
CREATE POLICY shalom_agencies_update ON shalom_agencies FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shalom_agencies_delete ON shalom_agencies;
CREATE POLICY shalom_agencies_delete ON shalom_agencies FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_shalom_agencies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shalom_agencies_updated_at ON shalom_agencies;
CREATE TRIGGER shalom_agencies_updated_at
  BEFORE UPDATE ON shalom_agencies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_shalom_agencies_updated_at();

-- 2. Shipments ----------------------------------------------------

CREATE TABLE IF NOT EXISTS shipments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id         uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sale_id            uuid REFERENCES sales(id) ON DELETE SET NULL,
  region             text CHECK (region IN ('lima', 'provincia')),
  -- Provincia
  city               text,
  agency_name        text,
  agency_address     text,
  -- Lima
  delivery_address   text,
  delivery_reference text,
  -- Shared
  recipient_name     text,
  recipient_dni      text,
  recipient_phone    text,
  receipt_photo_url  text,
  notes              text,
  -- collecting: still gathering data (bot and/or agent) — ready: has
  -- everything needed to hand off to Shalom/courier — shipped: handed
  -- to Shalom (Provincia) — at_agency: arrived at the destination
  -- agency, ready for pickup (Provincia) — out_for_delivery: courier
  -- dispatched (Lima) — delivered: closed.
  status             text NOT NULL DEFAULT 'collecting' CHECK (
    status IN ('collecting', 'ready', 'shipped', 'at_agency', 'out_for_delivery', 'delivered')
  ),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shipments_account_id_idx ON shipments (account_id);
CREATE INDEX IF NOT EXISTS shipments_contact_id_idx ON shipments (account_id, contact_id);
CREATE INDEX IF NOT EXISTS shipments_status_idx ON shipments (account_id, status);
CREATE INDEX IF NOT EXISTS shipments_sale_id_idx ON shipments (sale_id);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipments_select ON shipments;
CREATE POLICY shipments_select ON shipments FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shipments_insert ON shipments;
CREATE POLICY shipments_insert ON shipments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS shipments_update ON shipments;
CREATE POLICY shipments_update ON shipments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS shipments_delete ON shipments;
CREATE POLICY shipments_delete ON shipments FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_shipments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipments_updated_at ON shipments;
CREATE TRIGGER shipments_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_shipments_updated_at();

-- 3. New Telegram event: a shipment just became ready to pack -----

ALTER TABLE telegram_destinations DROP CONSTRAINT IF EXISTS telegram_destinations_event_key_check;
ALTER TABLE telegram_destinations ADD CONSTRAINT telegram_destinations_event_key_check
  CHECK (event_key IN ('needs_human', 'new_sale', 'handoff_lima', 'handoff_provincia', 'shipment_ready'));
