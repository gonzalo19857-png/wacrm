import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import type { CatalogProduct } from '@/lib/ai/marketing-agents'
import { buildAdsAdvisorPlannerSystemPrompt } from '@/lib/ai/studio-ads-agent'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getCampaignInsights, getCampaignReference, listCampaigns } from '@/lib/studio/meta-ads'

const MAX_TURNS = 20

/**
 * POST /api/studio/ads/chat  (agent+)
 *
 * The conversational planning step BEFORE the owner clicks "Crear
 * campañas" — same shape as /api/studio/calendar/chat, grounded in the
 * product catalog PLUS real Meta Ads performance and the account's own
 * proven campaign (best-effort: the chat still works if Meta isn't
 * connected yet, just without that grounding).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`studio-ads-chat:${userId}`, RATE_LIMITS.aiMarketingTeam)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }
    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)
    if (messages.length === 0) {
      return NextResponse.json({ error: 'Send a message to the advisor.' }, { status: 400 })
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[studio/ads/chat] loadAiConfig error:', err)
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

    // Best-effort Meta grounding — the advisor chat should still work
    // (just without campaign-specific context) if Meta isn't connected
    // or a lookup fails, rather than blocking the whole conversation.
    let campaignInsights = null
    let referenceCampaigns: Awaited<ReturnType<typeof getCampaignReference>>[] = []
    try {
      const { data: connection } = await supabase
        .from('studio_meta_connections')
        .select('ad_account_id, long_lived_user_token')
        .eq('account_id', accountId)
        .maybeSingle()
      if (connection?.ad_account_id) {
        const accessToken = decrypt(connection.long_lived_user_token)
        const adAccountId = connection.ad_account_id as string
        campaignInsights = await getCampaignInsights({ adAccountId, accessToken })
        const campaigns = await listCampaigns({ adAccountId, accessToken })
        // Full targeting/creative detail for every ACTIVE campaign (capped —
        // each one is a couple more Graph API calls), not just one, so the
        // owner can ask the advisor about any of their running campaigns.
        const active = campaigns.filter((c) => c.status === 'ACTIVE').slice(0, 10)
        const targets = active.length > 0 ? active : campaigns.slice(0, 1)
        referenceCampaigns = await Promise.all(
          targets.map((c) => getCampaignReference({ adAccountId, accessToken, campaignId: c.id })),
        )
      }
    } catch (err) {
      console.error('[studio/ads/chat] Meta grounding lookup failed (continuing without it):', err)
    }

    const systemPrompt = buildAdsAdvisorPlannerSystemPrompt({
      businessContext: config.systemPrompt,
      products,
      campaignInsights,
      referenceCampaigns,
    })

    const { text } = await generateReply({ config, systemPrompt, messages })
    return NextResponse.json({ reply: text })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
