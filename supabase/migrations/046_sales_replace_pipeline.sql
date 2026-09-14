-- ============================================================
-- SALES — replaces the deals/pipelines/pipeline_stages feature
--
-- The account using this CRM found the Kanban pipeline unhelpful for
-- what they actually wanted: a running log of registered sales,
-- filterable by date range, with a total (Reports page + sale-tag
-- price prompt, both added just before this migration). Rather than
-- keep dragging pipeline_id/stage_id through that flow, this is a
-- dedicated, decoupled table — just the sale, no stage concept.
--
-- Step 1: create `sales` and carry over every non-lost deal so the
-- 26 rows already registered (25 backfilled from WhatsApp history +
-- 1 pre-existing) aren't lost. Step 2: drop the old tables — this
-- deployment has exactly one account (verified before running this),
-- so there's no cross-account blast radius to worry about.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  title       text NOT NULL,
  value       numeric(12,2) NOT NULL DEFAULT 0,
  currency    text NOT NULL DEFAULT 'USD',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_account_id_idx ON sales (account_id);
CREATE INDEX IF NOT EXISTS sales_contact_id_idx ON sales (contact_id);
CREATE INDEX IF NOT EXISTS sales_created_at_idx ON sales (created_at);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_select ON sales;
CREATE POLICY sales_select ON sales FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS sales_insert ON sales;
CREATE POLICY sales_insert ON sales FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS sales_update ON sales;
CREATE POLICY sales_update ON sales FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS sales_delete ON sales;
CREATE POLICY sales_delete ON sales FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_sales_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_updated_at ON sales;
CREATE TRIGGER sales_updated_at
  BEFORE UPDATE ON sales
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sales_updated_at();

-- Carry over every deal that isn't 'lost' — a lost deal was never a
-- real sale. Stage/pipeline info has no equivalent here and is
-- dropped; the sale itself (who, how much, when) is what's preserved.
INSERT INTO sales (account_id, user_id, contact_id, title, value, currency, notes, created_at, updated_at)
SELECT account_id, user_id, contact_id, title, value,
       COALESCE(currency, 'USD'), notes, created_at, updated_at
FROM deals
WHERE status IS DISTINCT FROM 'lost';

DROP TABLE IF EXISTS deals CASCADE;
DROP TABLE IF EXISTS pipeline_stages CASCADE;
DROP TABLE IF EXISTS pipelines CASCADE;

-- redeem_invitation (migration 019) checks the joining account has no
-- domain data before letting someone accept an invite into a shared
-- account — one of the tables it checked was `pipelines`, which no
-- longer exists. Re-declare with that line dropped; everything else
-- (including the grants) is identical to the 019 original.
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  -- the joined account_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Caller's current account + its owner.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    -- Defensive — every authenticated user has a profile post-017.
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: the inviter sent themselves a link, or the
  -- caller is somehow already in the inviter's account.
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the SOLE OWNER of their current
  -- account (i.e. their fresh personal account from signup or a
  -- prior removal). Any other state means they're either:
  --   - a member of another shared account (joining a second
  --     would silently orphan their access to the first), or
  --   - the owner of an account with teammates (they'd abandon
  --     their team to join the inviter's).
  -- Either way, the safe answer is "make a different login".
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Belt: even if they own their account, refuse if it has any
  -- domain data — joining would orphan their contacts, sales,
  -- broadcasts, automations, flows, templates, etc.
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM sales WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account. Empty by the checks
  -- above, so this is purely housekeeping — no cascades fire
  -- because no other rows reference it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
