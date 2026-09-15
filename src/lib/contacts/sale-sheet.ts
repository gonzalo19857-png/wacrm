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
