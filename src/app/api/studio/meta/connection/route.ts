import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getPageWhatsAppNumber } from '@/lib/studio/meta-graph'

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
        'page_id, page_name, instagram_username, connected_at, ad_account_id, ad_account_name, ad_account_currency, page_access_token',
      )
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ connection: null })

    // Best-effort — the connection is still useful without this field
    // if the lookup fails (e.g. the Page grant doesn't cover it).
    let whatsappNumber: string | null = null
    try {
      whatsappNumber = await getPageWhatsAppNumber({
        pageId: data.page_id,
        pageAccessToken: decrypt(data.page_access_token),
      })
    } catch (err) {
      console.error('[studio/meta/connection] whatsapp number lookup failed:', err)
    }

    const { page_access_token: _pageAccessToken, ...publicFields } = data
    return NextResponse.json({ connection: { ...publicFields, whatsapp_number: whatsappNumber } })
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
