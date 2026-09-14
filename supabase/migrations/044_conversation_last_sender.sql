-- ============================================================
-- LAST-MESSAGE SENDER ON CONVERSATIONS
--
-- The inbox list only ever showed last_message_text/last_message_at,
-- so a row looked identical whether the customer was left waiting on
-- a reply or the bot/agent had already answered — the only way to
-- tell was opening the chat. This adds who sent that last message so
-- the UI can flag "customer spoke last, this needs a reply" without
-- an extra query per row.
--
-- Populated at every site that already writes last_message_text:
--   - bump_conversation_on_inbound (webhook, customer messages)
--   - src/lib/flows/meta-send.ts (bot sends — text/media/interactive)
--   - src/lib/automations/meta-send.ts (bot sends)
--   - src/lib/whatsapp/send-message.ts (agent sends via composer/API)
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_sender_type TEXT
    CHECK (last_message_sender_type IN ('customer', 'agent', 'bot'));

CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(
  p_conversation_id UUID,
  p_last_message_text TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET unread_count              = COALESCE(unread_count, 0) + 1,
      last_message_text         = p_last_message_text,
      last_message_sender_type  = 'customer',
      last_message_at           = NOW(),
      updated_at                = NOW()
  WHERE id = p_conversation_id;
$$;
