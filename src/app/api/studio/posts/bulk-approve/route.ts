import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { validateForApproval } from '../[id]/approve/route'
import { recordApprovedGeneratedMedia } from '@/lib/studio/brand-references'

/**
 * POST /api/studio/posts/bulk-approve  (agent+)
 * Body: { campaignId: string, publishAtByPostId: Record<string, string> }
 * Approves every 'proposed' post in the campaign that has an entry in
 * publishAtByPostId AND passes the same validation as the single-post
 * approve route. Posts that fail validation are skipped and reported
 * back, not silently dropped.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : null
    const publishAtByPostId =
      body?.publishAtByPostId && typeof body.publishAtByPostId === 'object'
        ? (body.publishAtByPostId as Record<string, string>)
        : null
    if (!campaignId || !publishAtByPostId) {
      return NextResponse.json(
        { error: 'campaignId and publishAtByPostId are required.' },
        { status: 400 },
      )
    }

    const { data: posts, error: postsError } = await supabase
      .from('studio_posts')
      .select('id, status, platform, format, media_url, media_source, media_prompt')
      .eq('account_id', accountId)
      .eq('campaign_id', campaignId)
      .eq('status', 'proposed')
    if (postsError) throw postsError

    const { data: connection } = await supabase
      .from('studio_meta_connections')
      .select('instagram_business_account_id')
      .eq('account_id', accountId)
      .maybeSingle()
    const hasInstagram = !!connection?.instagram_business_account_id

    const approvedIds: string[] = []
    const skipped: { id: string; reason: string }[] = []

    for (const post of posts ?? []) {
      const publishAt = publishAtByPostId[post.id]
      if (!publishAt || Number.isNaN(Date.parse(publishAt))) {
        skipped.push({ id: post.id, reason: 'Falta la fecha/hora de publicación.' })
        continue
      }
      const validationError = validateForApproval(post, hasInstagram)
      if (validationError) {
        skipped.push({ id: post.id, reason: validationError })
        continue
      }
      approvedIds.push(post.id)
    }

    const now = new Date().toISOString()
    for (const id of approvedIds) {
      const { error } = await supabase
        .from('studio_posts')
        .update({
          status: 'approved',
          publish_at: publishAtByPostId[id],
          approved_by: userId,
          approved_at: now,
        })
        .eq('id', id)
        .eq('account_id', accountId)
      if (error) throw error

      const approvedPost = posts?.find((p) => p.id === id)
      await recordApprovedGeneratedMedia(supabase, {
        accountId,
        postId: id,
        mediaSource: approvedPost?.media_source ?? null,
        mediaUrl: approvedPost?.media_url ?? null,
        mediaPrompt: approvedPost?.media_prompt ?? null,
      })
    }

    return NextResponse.json({ approved: approvedIds.length, skipped })
  } catch (err) {
    return toErrorResponse(err)
  }
}
