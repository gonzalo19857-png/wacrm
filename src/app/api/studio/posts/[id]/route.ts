import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const EDITABLE_FIELDS = [
  'scheduled_date',
  'scheduled_time',
  'platform',
  'format',
  'idea',
  'caption',
  'hashtags',
  'media_source',
  'product_id',
  'media_url',
  'media_prompt',
] as const

/**
 * PATCH /api/studio/posts/[id]  (agent+)
 * Edits a calendar post — only while it hasn't published yet. Once a
 * post is 'publishing'/'published'/'failed' it's locked to keep the
 * record of what actually went out accurate.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
    }

    const { data: existing, error: fetchError } = await supabase
      .from('studio_posts')
      .select('id, status, account_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (fetchError) throw fetchError
    if (!existing) {
      return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
    }
    if (!['proposed', 'approved'].includes(existing.status)) {
      return NextResponse.json(
        { error: 'This post can no longer be edited.' },
        { status: 400 },
      )
    }

    const update: Record<string, unknown> = {}
    for (const key of EDITABLE_FIELDS) {
      if (key in body) update[key] = body[key]
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('studio_posts')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single()
    if (error) throw error

    return NextResponse.json({ post: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
