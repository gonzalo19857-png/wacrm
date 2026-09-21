-- ============================================================
-- 055_studio_meta_connection.sql
--
-- "Studio" — the new marketing module — needs its own Meta connection
-- to publish to a Facebook Page + its linked Instagram Business
-- account. Unlike WhatsApp (manual token paste, migration 001), this
-- goes through real Facebook Login OAuth since Page/Instagram
-- publishing tokens aren't something an owner can just copy-paste from
-- a settings screen.
--
-- One row per account (like whatsapp_config) — the owner explicitly
-- chose to connect a single Page + Instagram account rather than
-- managing several, so there's no per-post page picker anywhere
-- downstream.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS studio_meta_connections (
  account_id                     uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  meta_user_id                   text NOT NULL,
  long_lived_user_token          text NOT NULL,   -- AES-256-GCM-encrypted, same as ai_configs.api_key
  page_id                        text NOT NULL,
  page_name                      text NOT NULL,
  page_access_token              text NOT NULL,   -- AES-256-GCM-encrypted
  instagram_business_account_id  text,
  instagram_username             text,
  connected_by                   uuid REFERENCES auth.users(id),
  connected_at                   timestamptz NOT NULL DEFAULT now(),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE studio_meta_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_meta_connections_select ON studio_meta_connections;
CREATE POLICY studio_meta_connections_select ON studio_meta_connections FOR SELECT
  USING (is_account_member(account_id));

-- Write access is admin-only, same tier as whatsapp_config — this row
-- carries live publish tokens, not just operational config.
DROP POLICY IF EXISTS studio_meta_connections_insert ON studio_meta_connections;
CREATE POLICY studio_meta_connections_insert ON studio_meta_connections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS studio_meta_connections_update ON studio_meta_connections;
CREATE POLICY studio_meta_connections_update ON studio_meta_connections FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS studio_meta_connections_delete ON studio_meta_connections;
CREATE POLICY studio_meta_connections_delete ON studio_meta_connections FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_studio_meta_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_meta_connections_updated_at ON studio_meta_connections;
CREATE TRIGGER studio_meta_connections_updated_at
  BEFORE UPDATE ON studio_meta_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_studio_meta_connections_updated_at();
