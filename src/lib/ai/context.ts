import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  content_type: 'text' | 'image'
}

/**
 * Fetch the last N text-bearing messages of a conversation and map them
 * to the provider-neutral chat shape. Customer messages become `user`;
 * agent and bot messages become `assistant`.
 *
 * Includes both `text` and `image` messages: every auto-reply that
 * attaches a product photo sends it as one image message with the
 * reply as its caption (see `dispatchInboundToAiReply`), so excluding
 * `image` would drop the model's own talla/price recommendation from
 * its next turn's context whenever a photo was attached — the model
 * then has no memory of having already answered, and re-derives (and
 * re-states) the same recommendation on the customer's next message.
 * Confirmed live: this is what caused a bare "Lima" follow-up to get a
 * reply that repeated the whole recommendation block. Other non-text
 * message types (templates, interactive, audio) are still excluded —
 * they carry no caption to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, content_type')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'image'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows.flatMap((m) => {
    if (m.content_text && m.content_text.trim()) {
      return [{
        role: m.sender_type === 'customer' ? 'user' as const : 'assistant' as const,
        content: m.content_text.trim(),
      }]
    }

    // A payment receipt usually arrives as an uncaptioned image. Keep that
    // fact in the model's context (without pretending we read the image), so
    // it can advance only when the preceding conversation makes clear this
    // was the requested proof rather than treating a 👍 as payment.
    if (m.sender_type === 'customer' && m.content_type === 'image') {
      return [{ role: 'user' as const, content: '[El cliente envió una imagen.]' }]
    }
    return []
  })
}
