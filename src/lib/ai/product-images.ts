import type { SupabaseClient } from '@supabase/supabase-js'

/** Extensions saved under `ai_product_images` that are actually a video
 *  file (e.g. a product demo clip), not a photo — despite the table's
 *  `image_url` column name, which predates LED's video keys. Checked
 *  against the URL's path, ignoring any query string. */
const VIDEO_EXTENSIONS = /\.(mp4|mov|3gp|webm|m4v)$/i

/**
 * Which WhatsApp/Messenger media type a resolved `[[IMAGE:<key>]]` URL
 * actually is — inferred from the file extension since
 * `ai_product_images` has no kind column of its own. Sending a video
 * file with `kind: 'image'` is rejected by Meta's Graph API, so callers
 * that attach this URL to an outbound message must use this to pick
 * the right `kind`, not hardcode 'image'.
 */
export function mediaKindFromUrl(url: string): 'image' | 'video' {
  const path = url.split('?')[0]
  return VIDEO_EXTENSIONS.test(path) ? 'video' : 'image'
}

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
