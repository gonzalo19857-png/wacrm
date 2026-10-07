import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import {
  AI_VISION_MAX_IMAGES,
  AI_VISION_MAX_IMAGE_BYTES,
  aiContextMessageLimit,
} from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  content_type: 'text' | 'image'
  media_url: string | null
  media_type: string | null
}

/**
 * Download a customer photo and inline it as a base64 `data:` URI so a
 * vision-capable model can actually see it. Only works for an `http(s)`
 * `media_url` — the durable public URL `mirrorInboundMedia` writes to
 * the `chat-media` bucket. The other shape a row can carry is the
 * internal `/api/whatsapp/media/<id>` proxy (relative path, used when
 * mirroring failed or was skipped), which requires a logged-in session
 * and can't be fetched from this background job — callers fall back to
 * the text placeholder for that case. Best-effort: any failure (network,
 * oversized, non-2xx) just returns null rather than throwing, same
 * philosophy as `mirrorInboundMedia` itself.
 */
async function fetchImageDataUri(
  url: string,
  mimeType: string | null,
): Promise<string | null> {
  if (!url.startsWith('http')) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > AI_VISION_MAX_IMAGE_BYTES) return null
    const mime = mimeType || res.headers.get('content-type') || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Fetch the last N messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`.
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
 * The most recent `AI_VISION_MAX_IMAGES` customer photos in the window
 * are attached as real vision input (see `fetchImageDataUri`); older
 * ones, and any that fail to download, still register as "the customer
 * sent an image" via a text placeholder, same as before vision support.
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
    .select('sender_type, content_text, content_type, media_url, media_type')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'image'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()

  const customerImageIndexes = rows
    .map((m, i) => (m.sender_type === 'customer' && m.content_type === 'image' ? i : -1))
    .filter((i) => i >= 0)
  const visionIndexes = new Set(customerImageIndexes.slice(-AI_VISION_MAX_IMAGES))

  const out: ChatMessage[] = []
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i]
    const isCustomerImage = m.sender_type === 'customer' && m.content_type === 'image'

    if (isCustomerImage && visionIndexes.has(i) && m.media_url) {
      const dataUri = await fetchImageDataUri(m.media_url, m.media_type)
      if (dataUri) {
        out.push({ role: 'user', content: m.content_text?.trim() ?? '', images: [dataUri] })
        continue
      }
      // Download failed — fall through to the text-only handling below.
    }

    if (m.content_text && m.content_text.trim()) {
      out.push({
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content: m.content_text.trim(),
      })
      continue
    }

    // A payment receipt usually arrives as an uncaptioned image. Keep that
    // fact in the model's context (without pretending we read the image), so
    // it can advance only when the preceding conversation makes clear this
    // was the requested proof rather than treating a 👍 as payment.
    if (isCustomerImage) {
      out.push({ role: 'user', content: '[El cliente envió una imagen.]' })
    }
  }
  return out
}
