import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import type { CatalogProduct } from '@/lib/ai/marketing-agents'
import {
  buildCalendarGeneratorSystemPrompt,
  parseCalendarGeneration,
  serializeConversationAsNotes,
} from '@/lib/ai/studio-calendar-agent'
import { AiError, type ChatMessage } from '@/lib/ai/types'

/**
 * POST /api/studio/calendar/generate  (agent+)
 *
 * Proposes a month's content calendar: one studio_campaigns row plus
 * N studio_posts rows (status='proposed'), grounded in the account's
 * product catalog and business context. Nothing here is scheduled or
 * publishable yet — the owner reviews/edits/approves each post next.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`studio-calendar-generate:${userId}`, RATE_LIMITS.studioCalendarGenerate)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const month = typeof body?.month === 'string' ? body.month : null
    if (!month || !/^\d{4}-\d{2}-01$/.test(month)) {
      return NextResponse.json(
        { error: 'month is required (YYYY-MM-01).' },
        { status: 400 },
      )
    }
    // Prefer the planning-chat transcript (src/app/api/studio/calendar/chat)
    // as the brief when present — it's richer than a one-line note. Falls
    // back to a plain `notes` string for backward compat / no-chat usage.
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    const conversationNotes = rawMessages
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
    const notes = conversationNotes ?? (typeof body?.notes === 'string' ? body.notes : null)

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[studio/calendar/generate] loadAiConfig error:', err)
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
      .select('id, name, description, price, currency, image_url')
      .eq('account_id', accountId)
      .eq('active', true)
      .order('name', { ascending: true })
    if (productsError) throw productsError
    const productRowsSafe = productRows ?? []
    const products: CatalogProduct[] = productRowsSafe.map((p) => ({
      name: p.name,
      description: p.description,
      price: Number(p.price),
      currency: p.currency,
    }))

    const systemPrompt = buildCalendarGeneratorSystemPrompt({
      businessContext: config.systemPrompt,
      products,
      month,
      notes,
    })

    const { text } = await generateReply({
      config,
      systemPrompt,
      messages: [{ role: 'user', content: 'Genera el calendario del mes.' }],
    })

    let generated
    try {
      generated = parseCalendarGeneration(text)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'La IA devolvió datos inválidos.' },
        { status: 502 },
      )
    }

    const { data: campaign, error: campaignError } = await supabase
      .from('studio_campaigns')
      .insert({
        account_id: accountId,
        month,
        generation_notes: notes,
        status: 'draft',
        created_by: userId,
      })
      .select('id, month, status, generation_notes, created_at')
      .single()
    if (campaignError) throw campaignError

    // Match the model's free-text product_name back to a real catalog
    // row (exact, then substring) — case-insensitive, never inventing
    // a product that isn't in productRowsSafe.
    const resolveProduct = (name: string | null) => {
      if (!name) return null
      const lower = name.toLowerCase()
      return (
        productRowsSafe.find((p) => p.name.toLowerCase() === lower) ??
        productRowsSafe.find(
          (p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()),
        ) ??
        null
      )
    }

    const postsToInsert = generated.map((p) => {
      const matched = resolveProduct(p.productName)
      return {
        account_id: accountId,
        campaign_id: campaign.id,
        scheduled_date: p.date,
        platform: p.platform,
        format: p.format,
        idea: p.idea,
        caption: p.caption,
        hashtags: p.hashtags,
        product_id: matched?.id ?? null,
        media_source: matched ? 'product' : null,
        media_url: matched?.image_url ?? null,
        status: 'proposed',
      }
    })

    const { data: posts, error: postsError } = await supabase
      .from('studio_posts')
      .insert(postsToInsert)
      .select('*')
    if (postsError) throw postsError

    return NextResponse.json({ campaign, posts })
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
