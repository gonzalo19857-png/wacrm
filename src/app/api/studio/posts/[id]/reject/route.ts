import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * POST /api/studio/posts/[id]/reject  (agent+)
 * Marks a proposed/approved post as 'skipped' — it never publishes.
 * Kept as a separate endpoint (rather than folded into PATCH) since
 * it's the one status transition the owner triggers directly, same
 * shape as approve.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params

    const { data: existing, error: fetchError } = await supabase
      .from('studio_posts')
      .select('id, status')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (fetchError) throw fetchError
    if (!existing) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
    if (!['proposed', 'approved'].includes(existing.status)) {
      return NextResponse.json({ error: 'This post can no longer be changed.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('studio_posts')
      .update({ status: 'skipped' })
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
