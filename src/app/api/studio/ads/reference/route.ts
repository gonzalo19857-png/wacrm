import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { listCampaigns, getCampaignReference } from '@/lib/studio/meta-ads'

/**
 * GET /api/studio/ads/reference  (agent+)
 *
 * Returns targeting + creative for the account's active Meta Ads
 * campaign (or the most recently created one if none is ACTIVE), so a
 * new campaign can be built as a copy of a real, already-tuned one
 * instead of a blank guess. Read-only.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const { data: connection, error: connectionError } = await supabase
      .from('studio_meta_connections')
      .select('ad_account_id, long_lived_user_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (connectionError) throw connectionError
    if (!connection || !connection.ad_account_id) {
      return NextResponse.json(
        {
          error: 'No hay una cuenta publicitaria conectada. Reconecta Facebook en Conexiones.',
          code: 'ad_account_not_connected',
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(connection.long_lived_user_token)
    const adAccountId = connection.ad_account_id as string

    const campaigns = await listCampaigns({ adAccountId, accessToken })
    if (campaigns.length === 0) {
      return NextResponse.json(
        { error: 'No hay campañas en esta cuenta publicitaria.', code: 'no_campaigns' },
        { status: 404 },
      )
    }
    const target = campaigns.find((c) => c.status === 'ACTIVE') ?? campaigns[0]

    const reference = await getCampaignReference({
      adAccountId,
      accessToken,
      campaignId: target.id,
    })

    return NextResponse.json({ reference })
  } catch (err) {
    return toErrorResponse(err)
  }
}
