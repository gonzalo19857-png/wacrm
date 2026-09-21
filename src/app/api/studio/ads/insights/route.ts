import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getCampaignInsights } from '@/lib/studio/meta-ads'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/studio/ads/insights  (agent+)
 * GET /api/studio/ads/insights?since=YYYY-MM-DD&until=YYYY-MM-DD
 *
 * Campaign-level Meta Ads performance for the last 30 days (default)
 * or a custom inclusive date range, merged with the local studio_ads
 * row (name/status/daily_budget) when one exists for that campaignId.
 * Read-only — see src/lib/studio/meta-ads.ts.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const since = url.searchParams.get('since')
    const until = url.searchParams.get('until')
    let timeRange: { since: string; until: string } | undefined
    if (since || until) {
      if (!since || !until || !DATE_RE.test(since) || !DATE_RE.test(until)) {
        return NextResponse.json(
          { error: 'since and until must both be YYYY-MM-DD.' },
          { status: 400 },
        )
      }
      timeRange = { since, until }
    }

    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`studio-ads-insights:${userId}`, RATE_LIMITS.studioAdsInsights)
    if (!limit.success) return rateLimitResponse(limit)

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
    const insights = await getCampaignInsights({
      adAccountId: connection.ad_account_id,
      accessToken,
      timeRange,
    })

    const { data: localAds, error: localAdsError } = await supabase
      .from('studio_ads')
      .select('meta_campaign_id, name, status, daily_budget, currency')
      .eq('account_id', accountId)
      .not('meta_campaign_id', 'is', null)
    if (localAdsError) throw localAdsError

    const localByCampaignId = new Map((localAds ?? []).map((row) => [row.meta_campaign_id, row]))

    const campaigns = insights.map((row) => ({
      ...row,
      local: localByCampaignId.get(row.campaignId) ?? null,
    }))

    return NextResponse.json({ campaigns })
  } catch (err) {
    return toErrorResponse(err)
  }
}
