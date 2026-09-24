import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTelegramMessage } from '@/lib/telegram/send'
import { buildDailySummary } from '@/lib/telegram/daily-summary'

/**
 * POST /api/telegram/webhook/[id]
 *
 * Telegram's own callback for one destination's bot (migration 066) —
 * `[id]` is the `telegram_destinations` row id, set as the webhook URL
 * by `setTelegramWebhook` when the destination is created/its token is
 * rotated. Unauthenticated by necessity (Telegram calls this, not a
 * signed-in agent); the `X-Telegram-Bot-Api-Secret-Token` header is
 * what stands in for auth here, checked against the random secret we
 * generated for this destination and handed to Telegram at
 * registration time.
 *
 * Currently only handles "/resumen" (or any message containing
 * "resumen") by replying with today's sales + which open shipments are
 * still missing data — see src/lib/telegram/daily-summary.ts. Always
 * responds 200 so Telegram doesn't retry/disable the webhook; a
 * request that isn't a recognized command is just silently ignored.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const db = supabaseAdmin()
    const { data: dest } = await db
      .from('telegram_destinations')
      .select('account_id, bot_token, webhook_secret, is_active')
      .eq('id', id)
      .maybeSingle()

    if (!dest || !dest.is_active) return NextResponse.json({ ok: true })

    const providedSecret = request.headers.get('x-telegram-bot-api-secret-token')
    if (!dest.webhook_secret || providedSecret !== dest.webhook_secret) {
      // Wrong/missing secret — never process, but still 200 so a
      // misconfigured caller doesn't get any signal either way.
      return NextResponse.json({ ok: true })
    }

    const update = await request.json().catch(() => null)
    const text: string | undefined = update?.message?.text
    const chatId = update?.message?.chat?.id
    if (!text || !chatId) return NextResponse.json({ ok: true })

    const trimmed = text.trim()
    const isResumenCommand =
      trimmed.toLowerCase().startsWith('/resumen') || trimmed.toLowerCase().includes('resumen')
    if (!isResumenCommand) return NextResponse.json({ ok: true })

    const botToken = decrypt(dest.bot_token)
    const summary = await buildDailySummary(db, dest.account_id)
    const result = await sendTelegramMessage(botToken, String(chatId), summary)
    if (!result.ok) {
      console.error(`[telegram webhook] failed to send /resumen reply for destination ${id}: ${result.error}`)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(`[telegram webhook] threw for destination ${id}:`, err)
    return NextResponse.json({ ok: true })
  }
}
