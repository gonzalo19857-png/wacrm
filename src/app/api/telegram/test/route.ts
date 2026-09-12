import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTelegramMessage } from '@/lib/telegram/send'

/**
 * POST /api/telegram/test  (admin+)
 *
 * "Send test" button on the AI Assistant panel: sends a real Telegram
 * message to `chat_id` using `bot_token` (or, when either is omitted,
 * the account's stored value) so an admin can confirm the bot can
 * actually reach that chat before relying on it for handoff alerts.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`telegram-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const rawToken =
      typeof body.bot_token === 'string' ? body.bot_token.trim() : ''
    const rawChatId =
      typeof body.chat_id === 'string' ? body.chat_id.trim() : ''

    let botToken = rawToken
    let chatId = rawChatId
    if (!botToken || !chatId) {
      const { data: existing } = await supabase
        .from('ai_configs')
        .select('telegram_bot_token, telegram_chat_id')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!botToken && existing?.telegram_bot_token) {
        try {
          botToken = decrypt(existing.telegram_bot_token)
        } catch {
          return NextResponse.json(
            { error: 'Stored Telegram bot token could not be decrypted — re-enter it.' },
            { status: 400 },
          )
        }
      }
      if (!chatId && existing?.telegram_chat_id) chatId = existing.telegram_chat_id
    }

    if (!botToken || !chatId) {
      return NextResponse.json(
        { error: 'Enter a bot token and chat id to test.' },
        { status: 400 },
      )
    }

    const result = await sendTelegramMessage(
      botToken,
      chatId,
      '✅ wacrm: este chat recibirá los avisos cuando el bot derive una conversación a un asesor.',
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
