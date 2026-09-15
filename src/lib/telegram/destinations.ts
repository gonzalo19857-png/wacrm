import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTelegramMessage } from './send'

/**
 * Events the product can currently detect and route to a Telegram
 * destination (migration 049). Kept as a small fixed set matching the
 * `event_key` CHECK constraint — add here and in the migration
 * together when a new one is needed.
 */
export type TelegramEventKey =
  | 'needs_human'
  | 'new_sale'
  | 'handoff_lima'
  | 'handoff_provincia'

/**
 * DM every active destination an account has registered for
 * `eventKey` (migration 049) — an account may have zero, one, or
 * several bots subscribed to the same event, e.g. a generic "needs a
 * human" bot plus a separate one just for Lima orders. Best-effort per
 * destination: one bad token or an unreachable chat never blocks the
 * others, and a failure here must never propagate into the caller
 * (the event it's reporting — a handoff, a sale — has already been
 * persisted by the time this runs).
 */
export async function notifyTelegramDestinations(
  db: SupabaseClient,
  accountId: string,
  eventKey: TelegramEventKey,
  text: string,
): Promise<void> {
  const { data, error } = await db
    .from('telegram_destinations')
    .select('id, bot_token, chat_id')
    .eq('account_id', accountId)
    .eq('event_key', eventKey)
    .eq('is_active', true)

  if (error) {
    console.error(`[telegram] failed to load destinations for ${eventKey}:`, error)
    return
  }
  if (!data || data.length === 0) return

  await Promise.all(
    data.map(async (dest) => {
      try {
        const token = decrypt(dest.bot_token)
        const result = await sendTelegramMessage(token, dest.chat_id, text)
        if (!result.ok) {
          console.error(`[telegram] destination ${dest.id} (${eventKey}) failed: ${result.error}`)
        }
      } catch (err) {
        console.error(`[telegram] destination ${dest.id} (${eventKey}) threw:`, err)
      }
    }),
  )
}
