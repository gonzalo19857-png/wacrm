import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { deleteCampaignBestEffort } from '@/lib/studio/meta-ads'

/**
 * DELETE /api/studio/ads/[id]  (admin+)
 *
 * Deletes the campaign on Meta (best-effort — cascades to its ad set
 * and ad there) and removes the local row either way, so a mistaken
 * or duplicate paused campaign can be cleaned up without touching Ads
 * Manager directly.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { data: ad, error: adError } = await supabase
      .from('studio_ads')
      .select('meta_campaign_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (adError) throw adError
    if (!ad) {
      return NextResponse.json({ error: 'Ad not found.' }, { status: 404 })
    }

    if (ad.meta_campaign_id) {
      const { data: connection } = await supabase
        .from('studio_meta_connections')
        .select('ad_account_id, long_lived_user_token')
        .eq('account_id', accountId)
        .maybeSingle()
      if (connection?.ad_account_id) {
        await deleteCampaignBestEffort({
          adAccountId: connection.ad_account_id,
          accessToken: decrypt(connection.long_lived_user_token),
          campaignId: ad.meta_campaign_id,
        })
      }
    }

    const { error: deleteError } = await supabase
      .from('studio_ads')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (deleteError) throw deleteError

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
