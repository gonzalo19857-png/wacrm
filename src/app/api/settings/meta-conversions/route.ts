import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/settings/meta-conversions
 *
 * Any member may read it — the settings card needs to know whether
 * it's configured/active. The access token is never returned, only
 * whether one is stored.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('meta_conversions_configs')
      .select('dataset_id, access_token, page_id, is_active')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[settings/meta-conversions GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load the Meta Conversions API config' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })
    return NextResponse.json({
      configured: true,
      dataset_id: data.dataset_id,
      page_id: data.page_id,
      has_token: !!data.access_token,
      is_active: data.is_active,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/settings/meta-conversions  (admin+)
 *
 * Upsert the account's Conversions API dataset id + access token. The
 * token follows the same "send only when re-entered, else keep the
 * stored one" contract as the sheet webhook secret.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const datasetId = typeof body.dataset_id === 'string' ? body.dataset_id.trim() : ''
    if (!datasetId) return bad('dataset_id is required')

    const pageId = typeof body.page_id === 'string' ? body.page_id.trim() : ''
    if (!pageId) return bad('page_id is required')

    const rawToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''
    const isActive = body.is_active !== false

    const { data: existing } = await supabase
      .from('meta_conversions_configs')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!existing && !rawToken) return bad('access_token is required')

    const row: Record<string, unknown> = {
      account_id: accountId,
      dataset_id: datasetId,
      page_id: pageId,
      is_active: isActive,
    }
    if (rawToken) row.access_token = encrypt(rawToken)

    if (existing) {
      const { error } = await supabase
        .from('meta_conversions_configs')
        .update(row)
        .eq('account_id', accountId)
      if (error) {
        console.error('[settings/meta-conversions POST] update error:', error)
        return NextResponse.json({ error: 'Failed to save the Meta Conversions API config' }, { status: 500 })
      }
    } else {
      const { error } = await supabase.from('meta_conversions_configs').insert(row)
      if (error) {
        console.error('[settings/meta-conversions POST] insert error:', error)
        return NextResponse.json({ error: 'Failed to save the Meta Conversions API config' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/settings/meta-conversions  (admin+)
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('meta_conversions_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[settings/meta-conversions DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete the Meta Conversions API config' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
