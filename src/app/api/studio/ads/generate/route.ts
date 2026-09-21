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
import { createAdEndToEnd, type AdSetTargeting } from '@/lib/studio/meta-ads'

/**
 * POST /api/studio/ads/generate  (admin+)
 *
 * Takes the advisor chat transcript as a brief, asks the AI once for a
 * structured plan, and actually creates each proposed campaign on Meta
 * — same Click-to-WhatsApp path as the manual creator
 * (createAdEndToEnd), always PAUSED. A failure on one campaign doesn't
 * abort the rest; the response reports created vs failed so the owner
 * sees exactly what landed.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`studio-ads-generate:${userId}`, RATE_LIMITS.studioAdsAdvisorGenerate)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : ''
    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required.' }, { status: 400 })
    }
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

    let plan
    try {
      plan = parseAdsGeneration(text)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'La IA devolvió datos inválidos.' },
        { status: 502 },
      )
    }

    const accessToken = decrypt(connection.long_lived_user_token)
    const adAccountId = connection.ad_account_id as string
    const currency = connection.ad_account_currency ?? 'USD'
    const targeting: AdSetTargeting = { countries: ['PE'], ageMin: 18, ageMax: 65 }

    const created: unknown[] = []
    const failed: { name: string; error: string }[] = []

    for (const item of plan) {
      try {
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
