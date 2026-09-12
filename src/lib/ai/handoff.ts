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

/**
 * Best-effort Telegram DM fired alongside a handoff, so an admin who
 * isn't watching the inbox still finds out the moment a customer
 * needs a human. Swallows all errors — a Telegram outage or a bad
 * token must never affect the handoff itself, which has already
 * happened by the time this runs. Call with `void` (fire-and-forget),
 * same discipline as `logAiUsage`.
 */
export async function sendHandoffTelegramAlert(
  db: SupabaseClient,
  args: {
    telegramBotToken: string
    telegramChatId: string
    conversationId: string
    contactId: string
    summary: string
  },
): Promise<void> {
  const { telegramBotToken, telegramChatId, conversationId, contactId, summary } = args
  try {
    const { data: contact } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .maybeSingle()
    const who = contact?.name?.trim() || contact?.phone || 'un contacto'

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
    const link = siteUrl ? `\n\nAbrir: ${siteUrl}/inbox?c=${conversationId}` : ''

    const text = `🙋 Cliente interesado — el bot derivó la conversación\n\nContacto: ${who}\n${summary}${link}`

    const result = await sendTelegramMessage(telegramBotToken, telegramChatId, text)
    if (!result.ok) {
      console.error(
        `[ai handoff] Telegram alert failed for conversation ${conversationId}: ${result.error}`,
      )
    }
  } catch (err) {
    console.error(
      `[ai handoff] Telegram alert threw for conversation ${conversationId}:`,
      err,
    )
  }
}
