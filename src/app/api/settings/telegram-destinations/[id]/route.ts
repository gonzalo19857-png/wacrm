import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { setTelegramCommands, setTelegramWebhook, validateTelegramBotToken } from '@/lib/telegram/send'
import type { TelegramEventKey } from '@/lib/telegram/destinations'

const BOT_COMMANDS = [{ command: 'resumen', description: 'Resumen de pedidos y ventas del día' }]

/** Same best-effort webhook (re-)registration as the create route —
 *  needed here too because a new bot token means a brand-new bot with
 *  no webhook of its own yet. */
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
 * PATCH /api/settings/telegram-destinations/[id]  (admin+)
 *
 * Partial update. `bot_token` is only re-verified/re-encrypted when
 * the admin actually sent a new one — omitted means "keep the stored
 * one", same contract as the AI provider key.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const update: Record<string, unknown> = {}

    if ('label' in body) {
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      if (!label) return bad('label cannot be empty')
      update.label = label
    }
    if ('chat_id' in body) {
      const chatId = typeof body.chat_id === 'string' ? body.chat_id.trim() : ''
      if (!chatId) return bad('chat_id cannot be empty')
      update.chat_id = chatId
    }
    if ('event_key' in body) {
      if (!EVENT_KEYS.includes(body.event_key)) {
        return bad(`event_key must be one of: ${EVENT_KEYS.join(', ')}`)
      }
      update.event_key = body.event_key
    }
    if ('is_active' in body) {
      update.is_active = body.is_active === true
    }
    let rotatedToken: string | null = null
    if (typeof body.bot_token === 'string' && body.bot_token.trim()) {
      const botToken = body.bot_token.trim()
      const validation = await validateTelegramBotToken(botToken)
      if (!validation.ok) return bad(`Telegram bot token: ${validation.error}`)
      update.bot_token = encrypt(botToken)
      rotatedToken = botToken
    }

    if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

    if (rotatedToken) {
      const { data: existing } = await supabase
        .from('telegram_destinations')
        .select('webhook_secret')
        .eq('id', id)
        .eq('account_id', accountId)
        .maybeSingle()
      const secret = existing?.webhook_secret ?? randomBytes(24).toString('base64url')
      if (!existing?.webhook_secret) update.webhook_secret = secret
      await registerWebhook(id, rotatedToken, secret)
    }

    const { error } = await supabase
      .from('telegram_destinations')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) {
      console.error('[settings/telegram-destinations PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update the Telegram destination' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/settings/telegram-destinations/[id]  (admin+)
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { error } = await supabase
      .from('telegram_destinations')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) {
      console.error('[settings/telegram-destinations DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete the Telegram destination' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
