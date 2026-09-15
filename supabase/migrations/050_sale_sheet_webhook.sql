-- ============================================================
-- 050_sale_sheet_webhook.sql
--
-- Live spreadsheet integration: pushes sale/note/region events to an
-- Apps Script Web App bound to the account's own Google Sheet (no
-- Google API credentials — just an HTTP POST with a shared secret).
-- Unlike 048's Google Form push (append-only), this can locate and
-- update an EXISTING row later (a note added after the sale, or the
-- customer's region), which a Form can't do.
--
-- `region_value` on tags lets an admin designate a tag (e.g. "Lima",
-- "Provincia") that, when applied to a contact, pushes a `set_region`
-- event — same opt-in-per-tag pattern as `is_sale_tag` (045).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS sale_sheet_webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,
  secret      text NOT NULL,   -- AES-256-GCM-encrypted, same as ai_configs.api_key
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sale_sheet_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_sheet_webhooks_select ON sale_sheet_webhooks;
CREATE POLICY sale_sheet_webhooks_select ON sale_sheet_webhooks FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS sale_sheet_webhooks_insert ON sale_sheet_webhooks;
CREATE POLICY sale_sheet_webhooks_insert ON sale_sheet_webhooks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sale_sheet_webhooks_update ON sale_sheet_webhooks;
CREATE POLICY sale_sheet_webhooks_update ON sale_sheet_webhooks FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sale_sheet_webhooks_delete ON sale_sheet_webhooks;
CREATE POLICY sale_sheet_webhooks_delete ON sale_sheet_webhooks FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_sale_sheet_webhooks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sale_sheet_webhooks_updated_at ON sale_sheet_webhooks;
CREATE TRIGGER sale_sheet_webhooks_updated_at
  BEFORE UPDATE ON sale_sheet_webhooks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sale_sheet_webhooks_updated_at();

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS region_value text;
