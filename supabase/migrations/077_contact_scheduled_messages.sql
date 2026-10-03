-- ============================================================
-- 077_contact_scheduled_messages.sql — pick-a-date recontacto
--
-- Lets an agent, when adding a tag flagged tags.is_recontact_tag to a
-- contact, choose an exact date/time and an approved WhatsApp
-- template instead of a fixed per-automation wait — each tagging is
-- its own one-off scheduled send, not a rule applied to every contact
-- the same way. Drained by the same in-process scheduler that already
-- resolves automation Wait steps (see src/lib/automations/scheduler.ts)
-- — one 5-minute tick does both jobs rather than adding a second
-- interval.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE tags ADD COLUMN IF NOT EXISTS is_recontact_tag BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS contact_scheduled_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL,
  template_params JSONB NOT NULL DEFAULT '[]'::jsonb,
  send_at TIMESTAMPTZ NOT NULL,
  -- 'running' is the claim state the drain's optimistic lock uses
  -- between picking a due row up and finishing the send — same shape
  -- as automation_pending_executions.status.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'sent', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index tuned for the scheduler's hot-path poll (status =
-- 'pending' AND send_at <= now()), same shape as
-- automation_pending_executions / studio_posts.
CREATE INDEX IF NOT EXISTS idx_contact_scheduled_messages_due
  ON contact_scheduled_messages(send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_contact_scheduled_messages_contact
  ON contact_scheduled_messages(contact_id);

ALTER TABLE contact_scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_scheduled_messages_select ON contact_scheduled_messages;
CREATE POLICY contact_scheduled_messages_select ON contact_scheduled_messages FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS contact_scheduled_messages_insert ON contact_scheduled_messages;
CREATE POLICY contact_scheduled_messages_insert ON contact_scheduled_messages FOR INSERT
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());

-- Deleting (cancelling) a scheduled send is open to any account member,
-- same as tag management generally — not restricted to whoever
-- scheduled it, since any agent on the team may need to cancel one.
DROP POLICY IF EXISTS contact_scheduled_messages_delete ON contact_scheduled_messages;
CREATE POLICY contact_scheduled_messages_delete ON contact_scheduled_messages FOR DELETE
  USING (is_account_member(account_id));
