import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import type { CatalogProduct } from '@/lib/ai/marketing-agents'
import { serializeConversationAsNotes } from '@/lib/ai/studio-calendar-agent'
import { buildAdsGeneratorSystemPrompt, parseAdsGeneration } from '@/lib/ai/studio-ads-agent'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import { createAdEndToEnd, searchCity, type AdSetTargeting } from '@/lib/studio/meta-ads'

interface PlanItem {
  name: string
  dailyBudget: number
  headline: string
  message: string
  /** Explicit-mode only: real city-radius targeting for this campaign. */
  cities?: { query: string; radiusKm: number }[]
}

/**
 * POST /api/studio/ads/generate  (admin+)
 *
 * Two modes:
 * - AI-brief mode (default): takes the advisor chat transcript
 *   (`messages`) as a brief, asks the AI once for a structured plan.
 * - Explicit mode: the caller already has the exact plan (e.g. a
 *   precise city-by-city targeting worked out with the owner) and
 *   passes it directly as `campaigns`, skipping the AI planning step
 *   entirely. Each item's `cities` (free-text queries) are resolved to
 *   real Meta city-radius targeting via searchCity.
 *
 * Either way, every campaign is created for real via the same
 * Click-to-WhatsApp path as the manual creator (createAdEndToEnd),
 * always PAUSED. A failure on one campaign doesn't abort the rest —
 * the response reports created vs failed so the owner sees exactly
 * what landed.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`studio-ads-generate:${userId}`, RATE_LIMITS.studioAdsAdvisorGenerate)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : ''
    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required.' }, { status: 400 })
    }
    // Explicit mode only: reuse an existing uploaded video (same shape
    // as CreateAdEndToEndArgs['video']) across every campaign in this
    // batch instead of the static imageUrl.
    const video =
      body?.video && typeof body.video === 'object' && typeof body.video.videoId === 'string'
        ? {
            videoId: String(body.video.videoId),
            thumbnailUrl: String(body.video.thumbnailUrl ?? imageUrl),
            linkDescription:
              typeof body.video.linkDescription === 'string' ? body.video.linkDescription : undefined,
            pageWelcomeMessage:
              typeof body.video.pageWelcomeMessage === 'string' ? body.video.pageWelcomeMessage : undefined,
          }
        : undefined

    const { data: connection, error: connectionError } = await supabase
      .from('studio_meta_connections')
      .select('page_id, instagram_business_account_id, long_lived_user_token, ad_account_id, ad_account_currency')
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

    let plan: PlanItem[]

    const explicitCampaigns = Array.isArray(body?.campaigns) ? body.campaigns : null
    if (explicitCampaigns) {
      plan = explicitCampaigns.map((c: Record<string, unknown>) => ({
        name: String(c.name ?? ''),
        dailyBudget: Number(c.dailyBudget ?? 0),
        headline: String(c.headline ?? ''),
        message: String(c.message ?? ''),
        cities: Array.isArray(c.cities)
          ? (c.cities as { query: string; radiusKm: number }[])
          : undefined,
      }))
      if (plan.some((p) => !p.name || !p.headline || !p.message || !(p.dailyBudget > 0))) {
        return NextResponse.json({ error: 'Cada campaña necesita name, dailyBudget, headline y message.' }, { status: 400 })
      }
    } else {
      const rawMessages = Array.isArray(body?.messages) ? body.messages : null
      const notes = rawMessages
        ? serializeConversationAsNotes(
            rawMessages.filter(
              (m: unknown): m is ChatMessage =>
                !!m &&
                typeof m === 'object' &&
                ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
                typeof (m as ChatMessage).content === 'string',
            ),
          )
        : null
      if (!notes) {
        return NextResponse.json({ error: 'Conversa con el asesor antes de generar.' }, { status: 400 })
      }

      const config = await loadAiConfig(supabase, accountId, {
        requireActive: false,
      }).catch((err) => {
        console.error('[studio/ads/generate] loadAiConfig error:', err)
        throw new AiError('Stored API key could not be decrypted.', {
          code: 'key_decrypt_failed',
          status: 400,
        })
      })
      if (!config) {
        return NextResponse.json(
          {
            error: 'No agent configured yet. Add your provider key in AI Agents → Setup.',
            code: 'ai_not_configured',
          },
          { status: 400 },
        )
      }

      const { data: productRows, error: productsError } = await supabase
        .from('products')
        .select('name, description, price, currency')
        .eq('account_id', accountId)
        .eq('active', true)
        .order('name', { ascending: true })
      if (productsError) throw productsError
      const products: CatalogProduct[] = (productRows ?? []).map((p) => ({
        name: p.name,
        description: p.description,
        price: Number(p.price),
        currency: p.currency,
      }))

      const systemPrompt = buildAdsGeneratorSystemPrompt({
        businessContext: config.systemPrompt,
        products,
        notes,
      })
      const { text } = await generateReply({
        config,
        systemPrompt,
        messages: [{ role: 'user', content: 'Genera las campañas.' }],
      })

      try {
        plan = parseAdsGeneration(text)
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'La IA devolvió datos inválidos.' },
          { status: 502 },
        )
      }
    }

    const defaultTargeting: AdSetTargeting = { countries: ['PE'], ageMin: 18, ageMax: 65 }

    const created: unknown[] = []
    const failed: { name: string; error: string }[] = []

    for (const item of plan) {
      try {
        let targeting = defaultTargeting
        if (item.cities && item.cities.length > 0) {
          const resolved = await Promise.all(
            item.cities.map(async (c) => {
              const results = await searchCity({ accessToken, query: c.query, countryCode: 'PE' })
              const match = results.find((r) => r.countryCode === 'PE') ?? results[0]
              if (!match) throw new Error(`No se encontró la ciudad "${c.query}" en Meta.`)
              return { key: match.key, radiusKm: c.radiusKm }
            }),
          )
          targeting = { countries: ['PE'], ageMin: 18, ageMax: 65, cities: resolved }
        }

        const result = await createAdEndToEnd({
          adAccountId,
          accessToken,
          pageId: connection.page_id,
          instagramActorId: connection.instagram_business_account_id,
          name: item.name,
          dailyBudgetMinorUnits: Math.round(item.dailyBudget * 100),
          targeting,
          message: item.message,
          headline: item.headline,
          imageUrl,
          destinationType: 'whatsapp',
          video,
        })

        const { data: row, error: insertError } = await supabase
          .from('studio_ads')
          .insert({
            account_id: accountId,
            name: item.name,
            daily_budget: item.dailyBudget,
            currency,
            country: 'PE',
            age_min: 18,
            age_max: 65,
            gender: 'all',
            message: item.message,
            headline: item.headline,
            link_url: null,
            image_url: imageUrl,
            call_to_action: 'WHATSAPP_MESSAGE',
            destination_type: 'whatsapp',
            status: 'paused',
            meta_campaign_id: result.campaignId,
            meta_adset_id: result.adsetId,
            meta_creative_id: result.creativeId,
            meta_ad_id: result.adId,
            created_by: userId,
          })
          .select('*')
          .single()
        if (insertError) throw insertError
        created.push(row)
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : 'No se pudo crear la campaña en Meta.'
        failed.push({ name: item.name, error: message })
      }
    }

    return NextResponse.json({ created, failed })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
