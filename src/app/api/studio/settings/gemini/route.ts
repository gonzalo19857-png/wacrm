import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'

/**
 * GET /api/studio/settings/gemini  (agent+)
 * Never returns the key — just whether one is set.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('studio_ai_settings')
      .select('account_id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    return NextResponse.json({ hasKey: !!data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT /api/studio/settings/gemini  (admin+)
 * Body: { apiKey: string }
 */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey is required.' }, { status: 400 })
    }

    const { error } = await supabase
      .from('studio_ai_settings')
      .upsert(
        { account_id: accountId, gemini_api_key: encrypt(apiKey) },
        { onConflict: 'account_id' },
      )
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/studio/settings/gemini  (admin+)
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('studio_ai_settings')
      .delete()
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
