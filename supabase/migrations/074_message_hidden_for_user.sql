-- ============================================================
-- 074_message_hidden_for_user.sql — "Delete for me"
--
-- WhatsApp's own Cloud API (what this CRM sends/receives through)
-- has no endpoint to recall a message already delivered to the
-- customer's phone — "delete for everyone" like the WhatsApp app
-- offers is simply not available to a Business Cloud API integrator.
-- What IS buildable is WhatsApp's other option: "delete for me" —
-- hide a message from one agent's own view of the thread without
-- touching the underlying row, so other teammates and the customer
-- are unaffected.
--
-- One row per (message, user) that chose to hide it. `conversation_id`
-- is denormalised (same reasoning as `message_reactions`, migration
-- 009): Supabase Realtime can only filter with a plain `eq`, it can't
-- join, so the FK alone wouldn't let a second tab subscribe to its
-- own hides filtered by conversation.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS message_hidden_for_user (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_hidden_for_user_user
  ON message_hidden_for_user(user_id, conversation_id);

ALTER TABLE message_hidden_for_user ENABLE ROW LEVEL SECURITY;

-- A user only ever sees/manages their own hides — this is explicitly
-- NOT shared with teammates, that's the whole point of "for me".
DROP POLICY IF EXISTS message_hidden_for_user_select ON message_hidden_for_user;
CREATE POLICY message_hidden_for_user_select ON message_hidden_for_user FOR SELECT
  USING (user_id = auth.uid());

-- Hiding a message still requires the hider to be an account member
-- who can actually see that conversation — otherwise this table would
-- let anyone probe for the existence of a message_id/conversation_id
-- pair they have no access to.
DROP POLICY IF EXISTS message_hidden_for_user_insert ON message_hidden_for_user;
CREATE POLICY message_hidden_for_user_insert ON message_hidden_for_user FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_hidden_for_user.conversation_id
        AND is_account_member(c.account_id)
    )
  );

-- Un-hiding ("Undo") is always allowed on your own rows.
DROP POLICY IF EXISTS message_hidden_for_user_delete ON message_hidden_for_user;
CREATE POLICY message_hidden_for_user_delete ON message_hidden_for_user FOR DELETE
  USING (user_id = auth.uid());

-- Realtime — lets a second open tab for the same agent pick up a
-- hide/undo without a manual refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'message_hidden_for_user'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE message_hidden_for_user;
  END IF;
END $$;
