-- ============================================================
-- 075_quick_reply_video.sql
--
-- Lets a text quick reply carry a video instead of (never together
-- with) an image — same WhatsApp-Business-style "save as quick reply"
-- shortcut from migration 068, now covering video too. Reuses the
-- `product-media` bucket (054), which already allows video and is
-- sized for Meta's 16 MB outbound video cap — no new bucket needed.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE quick_replies
  ADD COLUMN IF NOT EXISTS video_url text;
