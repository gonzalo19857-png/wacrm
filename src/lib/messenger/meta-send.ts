import { decrypt } from '@/lib/whatsapp/encryption'
import { psidFromContactPhone } from './psid-utils'
import { supabaseAdmin } from './admin-client'

/**
 * Messenger Send API — used by the AI auto-reply bot to answer Facebook
 * Page / Marketplace buyer messages. Mirrors src/lib/flows/meta-send.ts
 * (WhatsApp's engine sender) but simpler: a PSID has exactly one valid
 * form, so there's no phone-variant retry to do.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

async function resolveRecipient(
  accountId: string,
  contactId: string,
): Promise<{ db: ReturnType<typeof supabaseAdmin>; psid: string; pageAccessToken: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }
  const psid = psidFromContactPhone(contact.phone)
  if (!psid) {
    throw new Error(`contact is not a Messenger contact: ${contact.phone}`)
  }

  const { data: connection, error: connectionErr } = await db
    .from('studio_meta_connections')
    .select('page_access_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (connectionErr || !connection?.page_access_token) {
    throw new Error('Facebook Page not connected for this account')
  }
  const pageAccessToken = decrypt(connection.page_access_token)

  return { db, psid, pageAccessToken }
}

interface SendMessengerTextArgs {
  accountId: string
  conversationId: string
  contactId: string
  text: string
  /** Marks the persisted message row `ai_generated = true`, same
   *  convention as the WhatsApp engine senders. */
  aiGenerated?: boolean
}

/** Send a plain-text Messenger message from the AI auto-reply bot. */
export async function engineSendMessengerText(
  args: SendMessengerTextArgs,
): Promise<{ messenger_message_id: string }> {
  const { db, psid, pageAccessToken } = await resolveRecipient(args.accountId, args.contactId)

  const response = await fetch(`${META_API_BASE}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { text: args.text },
      access_token: pageAccessToken,
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Messenger text send failed: ${response.status}`)
  }
  const data = (await response.json()) as { message_id?: string }
  const messageId = data.message_id
  if (!messageId) throw new Error('Messenger did not return a message id.')

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: messageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.text,
      last_message_sender_type: 'bot',
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { messenger_message_id: messageId }
}

interface SendMessengerMediaArgs {
  accountId: string
  conversationId: string
  contactId: string
  kind: 'image'
  /** Public URL Meta fetches at send time. */
  link: string
  caption?: string
  aiGenerated?: boolean
}

/**
 * Send an image from the AI auto-reply bot. Unlike WhatsApp, Messenger's
 * Send API has no separate caption field on an attachment — the caption
 * (if any) is sent as its own preceding text message so the customer
 * still sees the recommendation text, matching what the WhatsApp path
 * sends as one combined bubble.
 */
export async function engineSendMessengerMedia(
  args: SendMessengerMediaArgs,
): Promise<{ messenger_message_id: string }> {
  const { db, psid, pageAccessToken } = await resolveRecipient(args.accountId, args.contactId)

  if (args.caption) {
    await engineSendMessengerText({
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: args.caption,
      aiGenerated: args.aiGenerated,
    })
  }

  const response = await fetch(`${META_API_BASE}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: {
        attachment: { type: args.kind, payload: { url: args.link, is_reusable: true } },
      },
      access_token: pageAccessToken,
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Messenger media send failed: ${response.status}`)
  }
  const data = (await response.json()) as { message_id?: string }
  const messageId = data.message_id
  if (!messageId) throw new Error('Messenger did not return a message id.')

  const preview = args.caption?.trim() || `[${args.kind}]`
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind,
    content_text: null,
    media_url: args.link,
    message_id: messageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_sender_type: 'bot',
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { messenger_message_id: messageId }
}
