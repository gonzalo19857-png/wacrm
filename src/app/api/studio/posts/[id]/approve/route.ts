import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { recordApprovedGeneratedMedia } from '@/lib/studio/brand-references'

interface StudioPostRow {
  id: string
  status: string
  platform: 'facebook' | 'instagram'
  format: 'photo' | 'text'
  media_url: string | null
  media_source?: string | null
  media_prompt?: string | null
}

/**
 * Validate one post is publishable and return the update payload for
 * approving it, or an error message. Shared by the single-post and
 * bulk-approve routes so the rules can't drift between them.
 */
export function validateForApproval(
  post: StudioPostRow,
  hasInstagramAccount: boolean,
): string | null {
  if (post.format !== 'text' && !post.media_url) {
    return 'Falta una foto para esta publicación.'
  }
  if (post.platform === 'instagram') {
    if (post.format !== 'photo') {
      return 'Instagram no admite publicaciones de solo texto.'
    }
    if (!hasInstagramAccount) {
      return 'No hay una cuenta de Instagram conectada.'
    }
  }
  return null
}

/**
 * POST /api/studio/posts/[id]/approve  (agent+)
 * Body: { publishAt: string } — ISO timestamp, computed client-side
 * from the post's scheduled_date/scheduled_time in the browser's own
 * timezone (single-owner tool, no server timezone config needed).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { id } = await params
    const body = await request.json().catch(() => null)
    const publishAt = typeof body?.publishAt === 'string' ? body.publishAt : null
    if (!publishAt || Number.isNaN(Date.parse(publishAt))) {
      return NextResponse.json({ error: 'publishAt (ISO) is required.' }, { status: 400 })
    }

    const { data: post, error: postError } = await supabase
      .from('studio_posts')
      .select('id, status, platform, format, media_url, media_source, media_prompt')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (postError) throw postError
    if (!post) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
    if (post.status !== 'proposed') {
      return NextResponse.json({ error: 'This post is not pending approval.' }, { status: 400 })
    }

    const { data: connection } = await supabase
      .from('studio_meta_connections')
      .select('instagram_business_account_id')
      .eq('account_id', accountId)
      .maybeSingle()

    const validationError = validateForApproval(
      post as StudioPostRow,
      !!connection?.instagram_business_account_id,
    )
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('studio_posts')
      .update({
        status: 'approved',
        publish_at: publishAt,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single()
    if (error) throw error

    await recordApprovedGeneratedMedia(supabase, {
      accountId,
      postId: id,
      mediaSource: post.media_source ?? null,
      mediaUrl: post.media_url,
      mediaPrompt: post.media_prompt ?? null,
    })

    return NextResponse.json({ post: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
