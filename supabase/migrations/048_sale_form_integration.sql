-- ============================================================
-- 048_sale_form_integration.sql
--
-- Lets an account push every newly-registered sale (migration 045's
-- sale-tag flow) as a submission to an external Google Form — which
-- in turn appends a row to whatever Sheet the form is linked to. No
-- Google API credentials needed: Google Forms accepts a plain POST to
-- its own `.../formResponse` endpoint with `entry.<id>` fields, so
-- this only needs the form's response URL plus which entry id maps to
-- which piece of sale data. One row per account, admin-managed,
-- mirrors `ai_configs` / `whatsapp_config` for tenancy + RLS shape.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS sale_form_integrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  form_response_url   text NOT NULL,
  field_client_entry  text,
  field_product_entry text,
  field_price_entry   text,
  field_phone_entry   text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sale_form_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_form_integrations_select ON sale_form_integrations;
CREATE POLICY sale_form_integrations_select ON sale_form_integrations FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS sale_form_integrations_insert ON sale_form_integrations;
CREATE POLICY sale_form_integrations_insert ON sale_form_integrations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sale_form_integrations_update ON sale_form_integrations;
CREATE POLICY sale_form_integrations_update ON sale_form_integrations FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sale_form_integrations_delete ON sale_form_integrations;
CREATE POLICY sale_form_integrations_delete ON sale_form_integrations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_sale_form_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sale_form_integrations_updated_at ON sale_form_integrations;
CREATE TRIGGER sale_form_integrations_updated_at
  BEFORE UPDATE ON sale_form_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sale_form_integrations_updated_at();
