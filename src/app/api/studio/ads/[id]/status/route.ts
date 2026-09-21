import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { setAdActive } from '@/lib/studio/meta-ads'

/**
 * POST /api/studio/ads/[id]/status  (admin+)
 * Body: { action: 'activate' | 'pause' }
 *
 * Flips the campaign/adset/ad to ACTIVE or PAUSED together on Meta,
 * then mirrors the result locally. This is the ONLY path that turns
 * on real spend — gated at 'admin' and requires the exact ad id, no
 * bulk action.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const body = await request.json().catch(() => null)
    const action = body?.action
    if (action !== 'activate' && action !== 'pause') {
      return NextResponse.json({ error: "action must be 'activate' or 'pause'." }, { status: 400 })
    }

    const { data: ad, error: adError } = await supabase
      .from('studio_ads')
      .select('meta_campaign_id, meta_adset_id, meta_ad_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (adError) throw adError
    if (!ad || !ad.meta_campaign_id || !ad.meta_adset_id || !ad.meta_ad_id) {
      return NextResponse.json({ error: 'Ad not found.' }, { status: 404 })
    }

    const { data: connection, error: connectionError } = await supabase
      .from('studio_meta_connections')
      .select('long_lived_user_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (connectionError) throw connectionError
    if (!connection) {
      return NextResponse.json({ error: 'Meta connection not found.' }, { status: 400 })
    }

    const accessToken = decrypt(connection.long_lived_user_token)
    const active = action === 'activate'

    try {
      await setAdActive({
        accessToken,
        campaignId: ad.meta_campaign_id,
        adsetId: ad.meta_adset_id,
        adId: ad.meta_ad_id,
        active,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo actualizar el estado en Meta.'
      await supabase
        .from('studio_ads')
        .update({ status: 'error', error_detail: message })
        .eq('id', id)
        .eq('account_id', accountId)
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const { data: row, error: updateError } = await supabase
      .from('studio_ads')
      .update({ status: active ? 'active' : 'paused', error_detail: null })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single()
    if (updateError) throw updateError

    return NextResponse.json({ ad: row })
  } catch (err) {
    return toErrorResponse(err)
  }
}
