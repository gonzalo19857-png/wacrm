-- ============================================================
-- SALE TAGS
--
-- Lets an account mark a tag (e.g. "Venta") as one that should
-- register a sale: when the UI adds a tag with is_sale_tag = true to
-- a contact, it prompts for a price and creates a `deals` row for it
-- (src/lib/contacts/sale-tag.ts). Opt-in per tag, not a hardcoded tag
-- name, so this only fires for accounts that explicitly turn it on
-- and can't misfire for an unrelated tag that happens to be named
-- "venta" in some other account.
-- ============================================================
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS is_sale_tag BOOLEAN NOT NULL DEFAULT false;
