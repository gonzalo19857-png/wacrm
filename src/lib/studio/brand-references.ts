import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * When a post whose photo was AI-generated gets approved, it's filed away
 * here as a brand style reference. Future calls to generateImage()
 * (src/lib/studio/gemini-image.ts) feed the account's most recent
 * references back in as visual conditioning, so the "look" the owner has
 * been approving compounds over time instead of every generation starting
 * from a blank slate. Shared by the single-post and bulk-approve routes so
 * the capture rule can't drift between them.
 */

const MAX_REFERENCES_PER_ACCOUNT = 20

export async function recordApprovedGeneratedMedia(
  supabase: SupabaseClient,
  args: {
    accountId: string
    postId: string
    mediaSource: string | null
    mediaUrl: string | null
    mediaPrompt: string | null
  },
): Promise<void> {
  const { accountId, postId, mediaSource, mediaUrl, mediaPrompt } = args
  if (mediaSource !== 'generated' || !mediaUrl) return

  const { error: insertError } = await supabase.from('studio_brand_references').insert({
    account_id: accountId,
    post_id: postId,
    image_url: mediaUrl,
    prompt: mediaPrompt,
  })
  if (insertError) throw insertError

  const { data: stale, error: staleError } = await supabase
    .from('studio_brand_references')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .range(MAX_REFERENCES_PER_ACCOUNT, MAX_REFERENCES_PER_ACCOUNT + 999)
  if (staleError) throw staleError
  if (stale && stale.length > 0) {
    const { error: deleteError } = await supabase
      .from('studio_brand_references')
      .delete()
      .in(
        'id',
        stale.map((r) => r.id as string),
      )
    if (deleteError) throw deleteError
  }
}

export async function getRecentBrandReferences(
  supabase: SupabaseClient,
  accountId: string,
  limit = 6,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('studio_brand_references')
    .select('image_url')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((r) => r.image_url as string)
}
