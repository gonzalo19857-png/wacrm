import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve a `[[IMAGE:<key>]]` sentinel (see defaults.ts) to the URL the
 * account configured for that key. Best-effort: any failure or missing
 * row resolves to null rather than throwing, matching the rest of the
 * auto-reply grounding path — a missing image key should degrade to a
 * text-only reply, never break the send.
 */
export async function getProductImage(
  db: SupabaseClient,
  accountId: string,
  key: string,
): Promise<string | null> {
  try {
    const { data } = await db
      .from('ai_product_images')
      .select('image_url')
      .eq('account_id', accountId)
      .eq('key', key)
      .maybeSingle()
    return (data as { image_url: string } | null)?.image_url ?? null
  } catch (err) {
    console.error('[ai product images] lookup failed:', err)
    return null
  }
}
