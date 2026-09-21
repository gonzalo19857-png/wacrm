import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import {
  MARKETING_TEAM,
  getMarketingAgent,
  buildMarketingSystemPrompt,
  type CatalogProduct,
} from '@/lib/ai/marketing-agents'
import { AiError, type ChatMessage } from '@/lib/ai/types'

const MAX_TURNS = 20

/**
 * GET /api/ai/marketing-team  (agent+)
 *
 * Static roster — no DB row per agent, just the fixed personas in
 * `marketing-agents.ts`.
 */
export async function GET() {
  try {
    await requireRole('agent')
    return NextResponse.json({
      agents: MARKETING_TEAM.map(({ id, name, role, description, icon }) => ({
        id,
        name,
        role,
        description,
        icon,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/marketing-team  (agent+)
 *
 * Chat with one marketing-team persona to draft content. Uses the same
 * BYO provider key as the auto-reply bot (`ai_configs`), grounded in the
 * account's product catalog instead of the WhatsApp knowledge base.
 * Stateless, same shape as `/api/ai/playground`.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-marketing-team:${userId}`, RATE_LIMITS.aiMarketingTeam)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const agent = getMarketingAgent(String(body?.agentId ?? ''))
    if (!agent) {
      return NextResponse.json({ error: 'Unknown agent' }, { status: 400 })
    }

    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to the agent.' },
        { status: 400 },
      )
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/marketing-team] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
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

    const systemPrompt = buildMarketingSystemPrompt({
      agent,
      businessContext: config.systemPrompt,
      products,
    })

    const { text } = await generateReply({ config, systemPrompt, messages })
    return NextResponse.json({ reply: text })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
