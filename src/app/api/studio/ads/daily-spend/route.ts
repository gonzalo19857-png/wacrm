import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getDailySpend } from '@/lib/studio/meta-ads'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/studio/ads/daily-spend?since=YYYY-MM-DD&until=YYYY-MM-DD  (agent+)
 *
 * One row per day of total ad spend across the whole account — a
 * bookkeeping log, not per-campaign detail (see /api/studio/ads/insights
 * for that). Read-only, on-demand: the caller decides when to refresh,
 * nothing here polls automatically.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`studio-ads-daily-spend:${userId}`, RATE_LIMITS.studioAdsInsights)
    if (!limit.success) return rateLimitResponse(limit)

    const url = new URL(request.url)
    const since = url.searchParams.get('since')
    const until = url.searchParams.get('until')
    if (!since || !until || !DATE_RE.test(since) || !DATE_RE.test(until)) {
      return NextResponse.json({ error: 'since and until (YYYY-MM-DD) are required.' }, { status: 400 })
    }

    const { data: connection, error: connectionError } = await supabase
      .from('studio_meta_connections')
      .select('ad_account_id, long_lived_user_token, ad_account_currency')
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
    const days = await getDailySpend({ adAccountId: connection.ad_account_id, accessToken, since, until })

    return NextResponse.json({ days, currency: connection.ad_account_currency ?? 'USD' })
  } catch (err) {
    return toErrorResponse(err)
  }
}
