-- ============================================================
-- 058_studio_ai_settings.sql
--
-- Studio's own AI settings — separate from ai_configs (the CRM's
-- auto-reply chat model) because this is a different capability
-- (image generation for calendar posts, via Gemini's image models)
-- with its own key, entered the same way ai_configs.api_key is: the
-- owner pastes their own key in Studio's Settings UI, never handled
-- by anyone else.
--
-- One row per account, same shape as whatsapp_config.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS studio_ai_settings (
  account_id      uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  gemini_api_key  text NOT NULL,   -- AES-256-GCM-encrypted, same as ai_configs.api_key
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE studio_ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_ai_settings_select ON studio_ai_settings;
CREATE POLICY studio_ai_settings_select ON studio_ai_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS studio_ai_settings_insert ON studio_ai_settings;
CREATE POLICY studio_ai_settings_insert ON studio_ai_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS studio_ai_settings_update ON studio_ai_settings;
CREATE POLICY studio_ai_settings_update ON studio_ai_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS studio_ai_settings_delete ON studio_ai_settings;
CREATE POLICY studio_ai_settings_delete ON studio_ai_settings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_studio_ai_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_ai_settings_updated_at ON studio_ai_settings;
CREATE TRIGGER studio_ai_settings_updated_at
  BEFORE UPDATE ON studio_ai_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_studio_ai_settings_updated_at();
