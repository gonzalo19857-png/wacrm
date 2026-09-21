import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { findOrCreateConversation } from '@/lib/conversations/find-or-create'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { toContactPhone } from '@/lib/messenger/psid-utils'

/**
 * Facebook Messenger webhook — auto-reply for Page/Marketplace buyer
 * messages. Deliberately thinner than src/app/api/whatsapp/webhook: no
 * templates, no interactive buttons, no delivery-status ladder, no
 * inbound-media mirroring — just text/image messages in, an AI reply
 * out, mirroring the "automate only the replies" scope this shipped for.
 *
 * Shares the same AI brain (src/lib/ai/auto-reply.ts) as WhatsApp — same
 * knowledge base, shipment/handoff logic, debounce, and rate limits —
 * via the `channel: 'messenger'` argument, which only changes which
 * Send API and formatting rules apply.
 */

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

interface MessengerAttachment {
  type: string
  payload?: { url?: string }
}

interface MessengerEvent {
  sender?: { id: string }
  recipient?: { id: string }
  message?: {
    mid: string
    text?: string
    is_echo?: boolean
    attachments?: MessengerAttachment[]
  }
}

interface MessengerWebhookBody {
  object?: string
  entry?: Array<{ id: string; messaging?: MessengerEvent[] }>
}

// GET - webhook verification (app-level subscription, one shared token
// unlike WhatsApp's per-account verify_token — see MESSENGER_WEBHOOK_VERIFY_TOKEN).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const challenge = searchParams.get('hub.challenge')
  const verifyToken = searchParams.get('hub.verify_token')

  const expected = process.env.MESSENGER_WEBHOOK_VERIFY_TOKEN
  if (!expected) {
    console.error('[messenger webhook] MESSENGER_WEBHOOK_VERIFY_TOKEN is not set — rejecting.')
    return NextResponse.json({ error: 'Verification not configured' }, { status: 500 })
  }

  if (mode === 'subscribe' && challenge && verifyToken === expected) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 })
}

// POST - receive messages
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[messenger webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: MessengerWebhookBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Ack fast, process after — same reasoning as the WhatsApp webhook
  // (serverless functions can be frozen the instant the response is
  // sent, so a floating promise's DB writes aren't guaranteed to land).
  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('[messenger webhook] processing error:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: MessengerWebhookBody) {
  if (body.object !== 'page' || !body.entry) return

  for (const entry of body.entry) {
    for (const event of entry.messaging ?? []) {
      // Echoes are our own sent messages bounced back — processing them
      // would loop the bot into replying to itself.
      if (!event.message || event.message.is_echo) continue
      const pageId = event.recipient?.id ?? entry.id
      const psid = event.sender?.id
      if (!psid || !pageId) continue

      const { data: connection, error: connectionErr } = await supabaseAdmin()
        .from('studio_meta_connections')
        .select('account_id, connected_by')
        .eq('page_id', pageId)
        .maybeSingle()

      if (connectionErr || !connection) {
        console.error('[messenger webhook] no studio_meta_connections row for page:', pageId)
        continue
      }
      if (!connection.connected_by) {
        console.error('[messenger webhook] connection has no connected_by user for account:', connection.account_id)
        continue
      }

      await processMessage(event.message, psid, connection.account_id, connection.connected_by)
    }
  }
}

const ALLOWED_CONTENT_TYPES = new Set(['text', 'image', 'document', 'audio', 'video'])

function mapAttachmentType(type: string): string {
  if (ALLOWED_CONTENT_TYPES.has(type)) return type
  if (type === 'file') return 'document'
  return 'text'
}

async function processMessage(
  message: NonNullable<MessengerEvent['message']>,
  psid: string,
  accountId: string,
  configOwnerUserId: string,
) {
  const contactPhone = toContactPhone(psid)

  const contactOutcome = await findOrCreateMessengerContact(accountId, configOwnerUserId, contactPhone)
  if (!contactOutcome) return
  const contact = contactOutcome.contact

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contact.id, 'messenger')
  if (!convResult) return
  const conversation = convResult.conversation

  const attachment = message.attachments?.[0]
  const contentType = attachment ? mapAttachmentType(attachment.type) : 'text'
  const contentText = message.text ?? null
  const mediaUrl = attachment?.payload?.url ?? null

  // Idempotent insert — Meta retries webhook deliveries, and each retry
  // replays the same message.mid. Mirrors the WhatsApp webhook's use of
  // the same (conversation_id, message_id) unique index (migration 037).
  const { data: insertedRows, error: msgError } = await supabaseAdmin()
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        message_id: message.mid,
        status: 'delivered',
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select()

  if (msgError) {
    console.error('[messenger webhook] error inserting message:', msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) {
    console.info('[messenger webhook] duplicate inbound message ignored:', message.mid)
    return
  }

  const { error: convError } = await supabaseAdmin().rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: contentText || `[${contentType}]`,
  })
  if (convError) {
    console.error('[messenger webhook] error bumping conversation:', convError)
  }

  if (contentText?.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contact.id,
      configOwnerUserId,
      channel: 'messenger',
    })
  }
}

async function findOrCreateMessengerContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
) {
  const existingContact = await findExistingContact(supabaseAdmin(), accountId, phone)
  if (existingContact) return { contact: existingContact, wasCreated: false }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      // Messenger profile lookup (first/last name) needs an extra
      // permission and is out of scope for v1 — the account can rename
      // the contact manually once they recognize who it is.
      name: 'Facebook Messenger',
    })
    .select()
    .single()

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone)
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[messenger webhook] error creating contact:', createError)
    return null
  }

  return { contact: newContact, wasCreated: true }
}
