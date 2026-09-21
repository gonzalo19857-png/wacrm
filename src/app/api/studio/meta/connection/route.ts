import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/studio/meta/connection  (agent+)
 * Returns the account's Meta connection status — never the tokens.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('studio_meta_connections')
      .select(
        'page_id, page_name, instagram_username, connected_at, ad_account_id, ad_account_name, ad_account_currency',
      )
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    return NextResponse.json({ connection: data ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/studio/meta/connection  (admin+)
 * Removes the local connection row. Does NOT revoke the grant on
 * Facebook's side — the UI tells the owner that.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('studio_meta_connections')
      .delete()
      .eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
