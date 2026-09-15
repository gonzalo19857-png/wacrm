import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTelegramMessage } from '@/lib/telegram/send'

/**
 * POST /api/telegram/test  (admin+)
 *
 * "Send test" button on a Telegram destination (migration 049): sends
 * a real Telegram message so an admin can confirm the bot can
 * actually reach that chat before relying on it for alerts. Two
 * shapes:
 *   - `{ destination_id }` — test an already-saved destination; the
 *     token is decrypted server-side and never sent to the client.
 *   - `{ bot_token, chat_id }` — test one not yet saved (the admin is
 *     still filling in the form).
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

    let botToken = typeof body.bot_token === 'string' ? body.bot_token.trim() : ''
    let chatId = typeof body.chat_id === 'string' ? body.chat_id.trim() : ''
    const destinationId =
      typeof body.destination_id === 'string' ? body.destination_id.trim() : ''

    if (destinationId) {
      const { data: dest } = await supabase
        .from('telegram_destinations')
        .select('bot_token, chat_id')
        .eq('id', destinationId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!dest) {
        return NextResponse.json({ error: 'Destination not found' }, { status: 404 })
      }
      try {
        botToken = decrypt(dest.bot_token)
      } catch {
        return NextResponse.json(
          { error: 'Stored Telegram bot token could not be decrypted — re-enter it.' },
          { status: 400 },
        )
      }
      chatId = chatId || dest.chat_id
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
      '✅ wacrm: este chat recibirá los avisos de este destino.',
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
