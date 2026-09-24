-- ============================================================
-- 066_shipment_product_and_telegram_commands.sql
--
-- Two additions aimed at the same problem: orders shipping late
-- because the product/model and delivery data don't reach whoever
-- packs them fast enough.
--
--   1. shipments.product — the vehicle/product name for the order.
--      Previously this was only ever computed on the fly (see
--      extractVehicleModel in src/lib/contacts/sale-sheet.ts) to push
--      into the Google Sheet — never stored, never shown in the
--      shipment panel, and never required for a shipment to count as
--      "ready". Now it's a first-class column: the AI bot's
--      `[[SHIPMENT:...]]` sentinel can set it, an agent can fill it
--      in the shipment panel/quick-form dialog, and a shipment can't
--      reach `ready` (and therefore can't fire the "shipment_ready"
--      Telegram alert) without it.
--
--   2. telegram_destinations.webhook_secret — lets a destination's bot
--      receive messages, not just send them. Set once a webhook is
--      registered with Telegram (POST /api/settings/telegram-destinations
--      calls setWebhook + setMyCommands right after creating a
--      destination); the incoming webhook route validates Telegram's
--      `X-Telegram-Bot-Api-Secret-Token` header against this value
--      before trusting a request. Used for the "/resumen" command —
--      an agent messages (or taps) it in any registered bot chat and
--      gets today's sales + which open shipments are still missing
--      data, so nothing sits half-filled unnoticed.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS product text;

ALTER TABLE telegram_destinations ADD COLUMN IF NOT EXISTS webhook_secret text;
