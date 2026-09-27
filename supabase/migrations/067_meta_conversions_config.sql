-- ============================================================
-- 067_meta_conversions_config.sql
--
-- Per-account config for the Meta Conversions API purchase-event push
-- (src/lib/meta/conversions-api.ts). Previously read from
-- META_CONVERSIONS_DATASET_ID / META_CONVERSIONS_API_TOKEN env vars,
-- but those only exist wherever `.env` was hand-edited — never
-- reliably present on every hosting setup this app runs on. Moved to
-- a DB-backed, admin-editable setting instead, same shape as
-- `sale_sheet_webhooks` (050): one row per account, token encrypted
-- at rest with the same AES-256-GCM helper.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_conversions_configs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  dataset_id   text NOT NULL,
  access_token text NOT NULL,   -- AES-256-GCM-encrypted, same as sale_sheet_webhooks.secret
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE meta_conversions_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_conversions_configs_select ON meta_conversions_configs;
CREATE POLICY meta_conversions_configs_select ON meta_conversions_configs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS meta_conversions_configs_insert ON meta_conversions_configs;
CREATE POLICY meta_conversions_configs_insert ON meta_conversions_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_conversions_configs_update ON meta_conversions_configs;
CREATE POLICY meta_conversions_configs_update ON meta_conversions_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_conversions_configs_delete ON meta_conversions_configs;
CREATE POLICY meta_conversions_configs_delete ON meta_conversions_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_meta_conversions_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS meta_conversions_configs_updated_at ON meta_conversions_configs;
CREATE TRIGGER meta_conversions_configs_updated_at
  BEFORE UPDATE ON meta_conversions_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_meta_conversions_configs_updated_at();
