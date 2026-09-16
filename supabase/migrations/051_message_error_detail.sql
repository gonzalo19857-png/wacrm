-- ============================================================
-- MESSAGE ERROR DETAIL
--
-- messages.status already tracks Meta's delivery ladder (pending →
-- sent → delivered → read, or the terminal `failed`), but nothing
-- stored *why* a failed send actually failed — Meta sends a real
-- reason (code + title + message) on the status webhook's `errors[]`
-- array, and it was being read nowhere and dropped. An agent staring
-- at a red "failed" icon had zero way to tell a bad number apart from
-- a rate limit apart from a policy rejection.
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_detail TEXT;
