-- ============================================================
-- CHAT LIFECYCLE TAGS — automatic Potencial / Caída tagging
--
-- Extends the existing opt-in tag-flag pattern (migration 045's
-- is_sale_tag) with two more flags an account can put on any tag of
-- its own:
--
--   - is_potential_tag — the bot applies this tag itself the moment
--     it tells a customer the payment methods (see the
--     [[STAGE:MEDIOS_PAGO]] sentinel in src/lib/ai/defaults.ts),
--     i.e. the customer got all the way to "how do I pay" without
--     actually buying yet.
--   - is_dropped_tag   — a scheduled job (see
--     src/app/api/tags/lifecycle/cron/route.ts) applies this tag to
--     any contact that has gone quiet for `dropped_after_hours`
--     without a sale tag on file, whether or not it ever reached
--     Potencial. Existing is_sale_tag contacts are always excluded.
--
-- Both are opt-in per tag (not a hardcoded name), same reasoning as
-- is_sale_tag: it only ever fires for accounts that explicitly turn
-- it on for one of their own tags.
-- ============================================================

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS is_potential_tag BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS is_dropped_tag BOOLEAN NOT NULL DEFAULT false;

-- Hours of inactivity (no message either direction) before a contact
-- without a sale tag gets marked dropped. Defaults to 48h — inside
-- the 24-48h window the account asked for.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS dropped_after_hours INTEGER NOT NULL DEFAULT 48;

-- Returns the contact ids for one account that:
--   - have no tag with is_sale_tag = true (never became a customer)
--   - have no tag with is_dropped_tag = true yet (not already tagged)
--   - have a conversation whose last_message_at (either direction) is
--     older than the threshold
-- Run from the lifecycle cron, one call per account that has an
-- is_dropped_tag tag configured.
CREATE OR REPLACE FUNCTION public.find_dropped_leads(
  p_account_id UUID,
  p_threshold_hours INTEGER
)
RETURNS TABLE(contact_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM contacts c
  JOIN LATERAL (
    SELECT last_message_at
    FROM conversations
    WHERE conversations.contact_id = c.id
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT 1
  ) conv ON true
  WHERE c.account_id = p_account_id
    AND conv.last_message_at IS NOT NULL
    AND conv.last_message_at < now() - (p_threshold_hours || ' hours')::interval
    AND NOT EXISTS (
      SELECT 1
      FROM contact_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id
        AND (t.is_sale_tag OR t.is_dropped_tag)
    );
$$;

REVOKE ALL ON FUNCTION public.find_dropped_leads(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_dropped_leads(UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.find_dropped_leads(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_dropped_leads(UUID, INTEGER) TO service_role;
