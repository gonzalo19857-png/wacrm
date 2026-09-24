import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * Live Google Sheet integration (migration 050) via an Apps Script Web
 * App bound to the account's own spreadsheet — see
 * supabase/migrations/050_sale_sheet_webhook.sql and the .gs template
 * handed to the account admin during setup. No Google API credentials
 * involved: a plain POST with a shared secret, same trust model as
 * the Telegram bot tokens.
 */

interface SheetWebhookConfig {
  webhookUrl: string
  secret: string
}

async function loadSheetWebhook(
  db: SupabaseClient,
  accountId: string,
): Promise<SheetWebhookConfig | null> {
  const { data } = await db
    .from('sale_sheet_webhooks')
    .select('webhook_url, secret, is_active')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data || !data.is_active) return null
  try {
    return { webhookUrl: data.webhook_url, secret: decrypt(data.secret) }
  } catch (err) {
    console.error(`[sale-sheet] secret for account ${accountId} could not be decrypted:`, err)
    return null
  }
}

/** Best-effort POST — swallows all errors. The event it's reporting
 *  (a sale, a note, a tag) has already been persisted in wacrm by the
 *  time this runs, so a broken/unreachable sheet must never surface
 *  as a failure to the caller. */
async function post(config: SheetWebhookConfig, body: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: config.secret, ...body }),
      redirect: 'follow',
    })
    if (!res.ok) {
      console.error(`[sale-sheet] webhook returned ${res.status} for action "${body.action}"`)
    }
  } catch (err) {
    console.error(`[sale-sheet] webhook threw for action "${body.action}":`, err)
  }
}

export async function pushCreateSale(
  db: SupabaseClient,
  accountId: string,
  args: { fecha: string; cliente: string; telefono: string; modelo: string; precio_venta: number },
): Promise<void> {
  const config = await loadSheetWebhook(db, accountId)
  if (!config) return
  await post(config, { action: 'create_sale', ...args })
}

export async function pushAppendNote(
  db: SupabaseClient,
  accountId: string,
  args: { telefono: string; note: string },
): Promise<void> {
  const config = await loadSheetWebhook(db, accountId)
  if (!config) return
  await post(config, { action: 'append_note', ...args })
}

export async function pushSetRegion(
  db: SupabaseClient,
  accountId: string,
  args: { telefono: string; ciudad: string },
): Promise<void> {
  const config = await loadSheetWebhook(db, accountId)
  if (!config) return
  await post(config, { action: 'set_region', ...args })
}

/** Human-readable label for each `shipments.status` value (migration
 *  052) — matches what the "update_shipment" Apps Script action writes
 *  into the "Estado envío" column. */
export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  collecting: 'Recolectando datos',
  ready: 'Listo para despacho',
  shipped: 'Enviado a agencia',
  at_agency: 'En agencia',
  out_for_delivery: 'En camino',
  delivered: 'Entregado',
}

/**
 * Push whatever delivery/shipping fields (migration 052's `shipments`
 * table) are known so far for a contact's most recent sale row — the
 * bot's `[[SHIPMENT:...]]` sentinel, an agent's edits in the shipment
 * panel, and a one-click status change all call this as their data
 * changes. Only non-empty fields are sent, and the Apps Script only
 * overwrites the matching cell for whichever ones it receives, so a
 * partial update (e.g. just `estado`) never blanks the others.
 *
 * Same match-by-phone limitation as `pushAppendNote`/`pushSetRegion`:
 * this finds the most recent "Ventas" row for the phone number, so it
 * only lands once a sale has actually been pushed there (i.e. the
 * "Venta" tag has been applied at least once) — a no-op otherwise.
 */
export async function pushUpdateShipment(
  db: SupabaseClient,
  accountId: string,
  args: {
    telefono: string
    ciudad?: string | null
    direccion?: string | null
    agencia?: string | null
    dni?: string | null
    estado?: string | null
    /** The vehicle/product (migration 066's `shipments.product`) —
     *  same key name as `pushCreateSale`'s `modelo` so the Apps Script
     *  can reuse the same "Modelo" column-write logic for an
     *  `update_shipment` action as it already does for `create_sale`. */
    modelo?: string | null
    /** The shipment's own recipient name (`shipments.recipient_name`) —
     *  distinct from `pushCreateSale`'s `cliente` (the buyer, set once
     *  at sale time): the recipient is confirmed later, during delivery
     *  data collection, and is who the "Destinatario" column tracks. */
    nombre?: string | null
  },
): Promise<void> {
  const config = await loadSheetWebhook(db, accountId)
  if (!config) return
  const { telefono, ciudad, direccion, agencia, dni, estado, modelo, nombre } = args
  await post(config, {
    action: 'update_shipment',
    telefono,
    ...(ciudad ? { ciudad } : {}),
    ...(direccion ? { direccion } : {}),
    ...(agencia ? { agencia } : {}),
    ...(dni ? { dni } : {}),
    ...(estado ? { estado } : {}),
    ...(nombre ? { nombre } : {}),
    ...(modelo ? { modelo } : {}),
  })
}

/**
 * Best-effort extraction of the vehicle model wacrm's own AI bot
 * already identified, by matching the fixed phrasing its system
 * prompt is instructed to use ("Para su X recomendamos..." / "Para su
 * mototaxi X tenemos el cobertor..."). Deliberately not another LLM
 * call — the bot's own reply already states the model in a rigid,
 * matchable format, so a fresh model call would just be re-deriving
 * (and risking disagreeing with) what it already said. Returns
 * "UNFOUND" when no bot message matches, per the account's own spec.
 */
export function extractVehicleModel(botMessages: string[]): string {
  const patterns = [
    /Para su\s+(.+?)\s+recomendamos/i,
    /Para su mototaxi\s+(.+?)\s+tenemos el cobertor/i,
  ]
  // Most recent message first — the latest recommendation wins if the
  // customer changed vehicles mid-conversation.
  for (const text of [...botMessages].reverse()) {
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match?.[1]) return match[1].trim()
    }
  }
  return 'UNFOUND'
}

/** A Peruvian DNI is always exactly 8 digits — bounded so a longer run
 *  (a 9-digit phone number, an order id) never matches part of itself. */
const DNI_RUN = /(?<!\d)(\d{8})(?!\d)/

/**
 * Best-effort fallback extraction of a DNI directly from what the
 * customer typed — a backstop for when a human agent collected it in
 * plain WhatsApp chat instead of the AI bot's own `[[SHIPMENT:...]]`
 * sentinel, which only ever fires while the bot itself is generating
 * the reply. Without this, a DNI the customer already gave a human
 * agent has to be re-read from the chat and retyped by hand into the
 * shipment panel/quick-form dialog — exactly the slow, error-prone
 * step that lets orders sit incomplete.
 *
 * Prefers a message that actually mentions "DNI" (far fewer false
 * positives than a bare 8-digit run, which could coincidentally be
 * something else); falls back to any standalone 8-digit token only if
 * no message mentions the word. Returns null — never a guess — when
 * nothing matches.
 */
export function extractDniFallback(customerMessages: string[]): string | null {
  const recent = [...customerMessages].reverse()
  for (const text of recent) {
    if (/\bdni\b/i.test(text)) {
      const match = text.match(DNI_RUN)
      if (match) return match[1]
    }
  }
  for (const text of recent) {
    const match = text.match(DNI_RUN)
    if (match) return match[1]
  }
  return null
}
