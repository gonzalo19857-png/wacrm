import type { SupabaseClient } from '@supabase/supabase-js'

export interface AiLocation {
  name: string | null
  address: string | null
  latitude: number
  longitude: number
}

/**
 * Resolve a `[[LOCATION:<key>]]` sentinel (see defaults.ts) to the real
 * WhatsApp location pin the account configured for that key. Best-effort:
 * any failure or missing row resolves to null rather than throwing,
 * matching `getProductImage` — a missing location key should degrade to
 * a text-only reply, never break the send.
 */
export async function getLocation(
  db: SupabaseClient,
  accountId: string,
  key: string,
): Promise<AiLocation | null> {
  try {
    const { data } = await db
      .from('ai_locations')
      .select('name, address, latitude, longitude')
      .eq('account_id', accountId)
      .eq('key', key)
      .maybeSingle()
    return data as AiLocation | null
  } catch (err) {
    console.error('[ai locations] lookup failed:', err)
    return null
  }
}
