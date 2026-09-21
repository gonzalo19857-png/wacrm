import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createAdEndToEnd, type AdSetTargeting } from '@/lib/studio/meta-ads'

const CALL_TO_ACTION_TYPES = new Set([
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'CONTACT_US',
  'GET_QUOTE',
  'SEND_MESSAGE',
])

/**
 * GET /api/studio/ads  (agent+)
 * Lists ads this account has created, newest first.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('studio_ads')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ ads: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/studio/ads  (admin+)
 *
 * Creates a real Campaign -> Ad Set -> Ad Creative -> Ad on the
 * account's connected Meta ad account — always PAUSED at every level
 * (see src/lib/studio/meta-ads.ts). Gated at 'admin' because this is
 * real ad spend once activated, not just draft content.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`studio-ads-create:${userId}`, RATE_LIMITS.studioAdsCreate)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const dailyBudget = typeof body?.dailyBudget === 'number' ? body.dailyBudget : NaN
    const country = typeof body?.country === 'string' ? body.country.trim().toUpperCase() : ''
    const ageMin = typeof body?.ageMin === 'number' ? Math.trunc(body.ageMin) : NaN
    const ageMax = typeof body?.ageMax === 'number' ? Math.trunc(body.ageMax) : NaN
    const gender = body?.gender === 'male' || body?.gender === 'female' ? body.gender : 'all'
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const headline = typeof body?.headline === 'string' ? body.headline.trim() : ''
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : ''
    const destinationType = body?.destinationType === 'whatsapp' ? 'whatsapp' : 'link'
    const linkUrl = typeof body?.linkUrl === 'string' ? body.linkUrl.trim() : ''
    const callToAction =
      destinationType === 'whatsapp'
        ? 'WHATSAPP_MESSAGE'
        : typeof body?.callToAction === 'string'
          ? body.callToAction
          : ''

    if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
      return NextResponse.json({ error: 'dailyBudget must be a positive number.' }, { status: 400 })
    }
    if (!/^[A-Z]{2}$/.test(country)) {
      return NextResponse.json({ error: 'country must be a 2-letter ISO code.' }, { status: 400 })
    }
    if (!Number.isFinite(ageMin) || !Number.isFinite(ageMax) || ageMin < 13 || ageMax > 65 || ageMin > ageMax) {
      return NextResponse.json({ error: 'ageMin/ageMax are invalid (13-65).' }, { status: 400 })
    }
    if (!message) return NextResponse.json({ error: 'message is required.' }, { status: 400 })
    if (!headline) return NextResponse.json({ error: 'headline is required.' }, { status: 400 })
    if (destinationType === 'link') {
      try {
        new URL(linkUrl)
      } catch {
        return NextResponse.json({ error: 'linkUrl must be a valid URL.' }, { status: 400 })
      }
      if (!CALL_TO_ACTION_TYPES.has(callToAction)) {
        return NextResponse.json({ error: 'callToAction is not a supported type.' }, { status: 400 })
      }
    }
    if (!imageUrl) return NextResponse.json({ error: 'imageUrl is required.' }, { status: 400 })

    const { data: connection, error: connectionError } = await supabase
      .from('studio_meta_connections')
      .select(
        'page_id, instagram_business_account_id, long_lived_user_token, ad_account_id, ad_account_currency',
      )
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
    const currency = connection.ad_account_currency ?? 'USD'

    // Assumes a 2-decimal currency (USD/PEN/etc, same assumption the
    // rest of the app makes for product prices) — minor units = *100.
    const dailyBudgetMinorUnits = Math.round(dailyBudget * 100)

    const targeting: AdSetTargeting = {
      countries: [country],
      ageMin,
      ageMax,
      genders: gender === 'male' ? 1 : gender === 'female' ? 2 : undefined,
    }

    try {
      const created = await createAdEndToEnd({
        adAccountId,
        accessToken,
        pageId: connection.page_id,
        instagramActorId: connection.instagram_business_account_id,
        name,
        dailyBudgetMinorUnits,
        targeting,
        message,
        headline,
        imageUrl,
        destinationType: destinationType === 'whatsapp' ? 'whatsapp' : undefined,
        linkUrl: destinationType === 'link' ? linkUrl : undefined,
        callToActionType: callToAction,
      })

      const { data: row, error: insertError } = await supabase
        .from('studio_ads')
        .insert({
          account_id: accountId,
          name,
          daily_budget: dailyBudget,
          currency,
          country,
          age_min: ageMin,
          age_max: ageMax,
          gender,
          message,
          headline,
          link_url: destinationType === 'link' ? linkUrl : null,
          image_url: imageUrl,
          call_to_action: callToAction,
          destination_type: destinationType,
          status: 'paused',
          meta_campaign_id: created.campaignId,
          meta_adset_id: created.adsetId,
          meta_creative_id: created.creativeId,
          meta_ad_id: created.adId,
          created_by: userId,
        })
        .select('*')
        .single()
      if (insertError) throw insertError

      return NextResponse.json({ ad: row })
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'No se pudo crear el anuncio en Meta.'
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
