import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { validateTelegramBotToken } from '@/lib/telegram/send'
import type { TelegramEventKey } from '@/lib/telegram/destinations'

const EVENT_KEYS: TelegramEventKey[] = [
  'needs_human',
  'new_sale',
  'handoff_lima',
  'handoff_provincia',
]

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/settings/telegram-destinations
 *
 * Any member may read the list (settings-class, mirrors ai_configs) —
 * `bot_token` is never selected, so nothing secret leaves the server.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('telegram_destinations')
      .select('id, label, chat_id, event_key, is_active, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
    if (error) {
      console.error('[settings/telegram-destinations GET] error:', error)
      return NextResponse.json({ error: 'Failed to load Telegram destinations' }, { status: 500 })
    }
    return NextResponse.json({ destinations: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/settings/telegram-destinations  (admin+)
 *
 * Create one destination. The bot token is verified with Telegram's
 * own `getMe` (same "verify before save" discipline as the AI
 * provider key) before it's encrypted and stored.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const label = typeof body.label === 'string' ? body.label.trim() : ''
    const botToken = typeof body.bot_token === 'string' ? body.bot_token.trim() : ''
    const chatId = typeof body.chat_id === 'string' ? body.chat_id.trim() : ''
    const eventKey = body.event_key as TelegramEventKey

    if (!label) return bad('label is required')
    if (!botToken) return bad('bot_token is required')
    if (!chatId) return bad('chat_id is required')
    if (!EVENT_KEYS.includes(eventKey)) {
      return bad(`event_key must be one of: ${EVENT_KEYS.join(', ')}`)
    }

    const validation = await validateTelegramBotToken(botToken)
    if (!validation.ok) return bad(`Telegram bot token: ${validation.error}`)

    const { data, error } = await supabase
      .from('telegram_destinations')
      .insert({
        account_id: accountId,
        label,
        bot_token: encrypt(botToken),
        chat_id: chatId,
        event_key: eventKey,
        is_active: body.is_active !== false,
      })
      .select('id, label, chat_id, event_key, is_active, created_at')
      .single()

    if (error) {
      console.error('[settings/telegram-destinations POST] error:', error)
      return NextResponse.json({ error: 'Failed to create the Telegram destination' }, { status: 500 })
    }
    return NextResponse.json({ destination: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
