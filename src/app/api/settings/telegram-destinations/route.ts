import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { setTelegramCommands, setTelegramWebhook, validateTelegramBotToken } from '@/lib/telegram/send'
import type { TelegramEventKey } from '@/lib/telegram/destinations'

/** Slash commands registered on every bot we create a webhook for —
 *  just "/resumen" for now (migration 066). */
const BOT_COMMANDS = [{ command: 'resumen', description: 'Resumen de pedidos y ventas del día' }]

/**
 * Best-effort: points the new destination's bot at our webhook route
 * and registers its "/resumen" slash command. Requires a public HTTPS
 * site URL (unset in local dev), so it's silently skipped there — the
 * destination still saves and works for outbound alerts either way.
 */
async function registerWebhook(destinationId: string, botToken: string, secret: string): Promise<void> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (!siteUrl) return
  try {
    const url = `${siteUrl}/api/telegram/webhook/${destinationId}`
    const result = await setTelegramWebhook(botToken, url, secret)
    if (!result.ok) {
      console.error(`[telegram-destinations] webhook registration failed for ${destinationId}: ${result.error}`)
      return
    }
    await setTelegramCommands(botToken, BOT_COMMANDS)
  } catch (err) {
    console.error(`[telegram-destinations] webhook registration threw for ${destinationId}:`, err)
  }
}

const EVENT_KEYS: TelegramEventKey[] = [
  'needs_human',
  'new_sale',
  'handoff_lima',
  'handoff_provincia',
  'shipment_ready',
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

    const webhookSecret = randomBytes(24).toString('base64url')

    const { data, error } = await supabase
      .from('telegram_destinations')
      .insert({
        account_id: accountId,
        label,
        bot_token: encrypt(botToken),
        chat_id: chatId,
        event_key: eventKey,
        is_active: body.is_active !== false,
        webhook_secret: webhookSecret,
      })
      .select('id, label, chat_id, event_key, is_active, created_at')
      .single()

    if (error) {
      console.error('[settings/telegram-destinations POST] error:', error)
      return NextResponse.json({ error: 'Failed to create the Telegram destination' }, { status: 500 })
    }

    await registerWebhook(data.id, botToken, webhookSecret)

    return NextResponse.json({ destination: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
