import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { sendTelegramMessage } from '@/lib/telegram/send'

/** Longest the quoted customer message runs before we ellipsize it —
 *  keeps the internal note to a glanceable one-liner. */
const MAX_QUOTE_LEN = 160

/**
 * Build the short internal note the auto-reply bot leaves on a
 * conversation when it hands off to a human. Deterministic — composed
 * from context we already have (no extra LLM call / token spend), so it
 * can't fail or add latency to the handoff.
 *
 * Reads as, e.g.:
 *   "🤖 AI agent handed off after 2 replies. Last customer message:
 *    “can I speak to a manager about my refund?”"
 *
 * `replyCount` is the bot's auto-reply tally for the thread (0 when it
 * bailed on the very first inbound without answering).
 */
export function buildHandoffSummary(args: {
  messages: ChatMessage[]
  replyCount: number
}): string {
  const { messages, replyCount } = args

  const lastCustomer = [...messages]
    .reverse()
    .find((m) => m.role === 'user' && m.content.trim())

  const replies =
    replyCount === 0
      ? 'without replying'
      : `after ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`

  const base = `🤖 AI agent handed off ${replies}.`

  if (!lastCustomer) return base

  const quote = truncate(lastCustomer.content.trim(), MAX_QUOTE_LEN)
  return `${base} Last customer message: “${quote}”`
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ')
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

/** Why a "needs a human" alert is firing — picks the header line. */
export type NeedsReplyReason = 'handoff' | 'needs_human'

const REASON_HEADERS: Record<NeedsReplyReason, string> = {
  handoff: '🙋 Cliente interesado — el bot derivó la conversación',
  needs_human: '💬 Mensaje nuevo que necesita respuesta humana',
}

/**
 * Best-effort Telegram DM so an admin who isn't watching the inbox
 * still finds out the moment a customer needs a human — whether
 * that's a fresh handoff (the bot's own summary as `detail`) or a
 * follow-up message on a thread nothing will auto-answer (already
 * handed off, assigned to an agent, or the bot hit its reply cap —
 * see the three new call sites in auto-reply.ts). Swallows all
 * errors — a Telegram outage or a bad token must never affect the
 * conversation state, which has already been persisted by the time
 * this runs. Callers still `await` it (see auto-reply.ts) so it can't
 * get orphaned mid-flight inside the webhook's `after()` block.
 */
export async function sendNeedsReplyTelegramAlert(
  db: SupabaseClient,
  args: {
    telegramBotToken: string
    telegramChatId: string
    conversationId: string
    contactId: string
    reason: NeedsReplyReason
    detail: string
  },
): Promise<void> {
  const { telegramBotToken, telegramChatId, conversationId, contactId, reason, detail } = args
  try {
    const { data: contact } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .maybeSingle()
    const who = contact?.name?.trim() || contact?.phone || 'un contacto'

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
    const link = siteUrl ? `\n\nAbrir: ${siteUrl}/inbox?c=${conversationId}` : ''

    const text = `${REASON_HEADERS[reason]}\n\nContacto: ${who}\n${detail}${link}`

    const result = await sendTelegramMessage(telegramBotToken, telegramChatId, text)
    if (!result.ok) {
      console.error(
        `[ai needs-reply] Telegram alert failed for conversation ${conversationId}: ${result.error}`,
      )
    }
  } catch (err) {
    console.error(
      `[ai needs-reply] Telegram alert threw for conversation ${conversationId}:`,
      err,
    )
  }
}

/**
 * Best-effort Telegram DM the moment a sale is registered (migration
 * 045's sale-tag price prompt). Independent of the "needs a human"
 * alert above — same bot token/chat id, own toggle (migration 047,
 * `telegram_notify_on_sale`) — so an account can run one without the
 * other. Swallows all errors: a Telegram outage must never fail the
 * tag-add request that just registered the sale.
 */
export async function sendNewSaleTelegramAlert(
  db: SupabaseClient,
  args: {
    telegramBotToken: string
    telegramChatId: string
    contactId: string
    title: string
    value: number
    currency: string
  },
): Promise<void> {
  const { telegramBotToken, telegramChatId, contactId, title, value, currency } = args
  try {
    const { data: contact } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .maybeSingle()
    const who = contact?.name?.trim() || contact?.phone || 'un contacto'

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
    const link = siteUrl ? `\n\nAbrir: ${siteUrl}/contacts` : ''

    const text = `💰 Nueva venta registrada\n\nContacto: ${who}\n${title} — ${currency} ${value.toLocaleString()}${link}`

    const result = await sendTelegramMessage(telegramBotToken, telegramChatId, text)
    if (!result.ok) {
      console.error(`[sale] Telegram alert failed for contact ${contactId}: ${result.error}`)
    }
  } catch (err) {
    console.error(`[sale] Telegram alert threw for contact ${contactId}:`, err)
  }
}

/**
 * Quote the customer's most recent message for a "needs a human"
 * alert that has no AI-generated handoff summary to lean on (the
 * assigned/already-handed-off/reply-cap gates in auto-reply.ts fire
 * before the conversation context is built). A dedicated query rather
 * than `buildConversationContext` — this only ever runs on the
 * notify path, so it's not worth loading the full context for it.
 */
export async function quoteLastCustomerMessage(
  db: SupabaseClient,
  conversationId: string,
): Promise<string> {
  const { data } = await db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const text = (data as { content_text: string | null } | null)?.content_text?.trim()
  if (!text) return 'Último mensaje: (sin texto — foto, audio u otro adjunto)'
  return `Último mensaje: "${truncate(text, MAX_QUOTE_LEN)}"`
}
