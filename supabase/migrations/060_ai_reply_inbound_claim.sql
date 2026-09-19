-- A customer can send several short WhatsApp messages within seconds.
-- Every webhook then starts an auto-reply task, so the generic reply-count
-- cap alone cannot tell which task owns the latest inbound burst.  Store the
-- exact inbound watermark that was answered and claim it atomically.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_last_replied_to_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.claim_ai_reply_for_latest_inbound(
  conversation_id UUID,
  max_replies INTEGER,
  expected_last_message_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1,
        ai_last_replied_to_at = expected_last_message_at
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
      AND last_message_sender_type = 'customer'
      AND last_message_at = expected_last_message_at
      AND (
        ai_last_replied_to_at IS NULL
        OR ai_last_replied_to_at < expected_last_message_at
      )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

REVOKE ALL ON FUNCTION public.claim_ai_reply_for_latest_inbound(UUID, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_ai_reply_for_latest_inbound(UUID, INTEGER, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.claim_ai_reply_for_latest_inbound(UUID, INTEGER, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_for_latest_inbound(UUID, INTEGER, TIMESTAMPTZ) TO service_role;
