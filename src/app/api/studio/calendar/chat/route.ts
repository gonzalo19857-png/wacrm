import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import type { CatalogProduct } from '@/lib/ai/marketing-agents'
import { buildCalendarPlannerSystemPrompt } from '@/lib/ai/studio-calendar-agent'
import { AiError, type ChatMessage } from '@/lib/ai/types'

const MAX_TURNS = 20

/**
 * POST /api/studio/calendar/chat  (agent+)
 *
 * The conversational planning step BEFORE the owner clicks "Generar
 * calendario" — same shape as /api/ai/marketing-team, but its own
 * route (Studio-only persona, not part of the CRM's 5-agent roster).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`studio-calendar-chat:${userId}`, RATE_LIMITS.aiMarketingTeam)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const month = typeof body?.month === 'string' ? body.month : null
    if (!month || !/^\d{4}-\d{2}-01$/.test(month)) {
      return NextResponse.json({ error: 'month is required (YYYY-MM-01).' }, { status: 400 })
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
          ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)
    if (messages.length === 0) {
      return NextResponse.json({ error: 'Send a message to the planner.' }, { status: 400 })
    }

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[studio/calendar/chat] loadAiConfig error:', err)
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

    const systemPrompt = buildCalendarPlannerSystemPrompt({
      businessContext: config.systemPrompt,
      products,
      month,
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
