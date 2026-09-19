import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getOpenShipmentForContact, overwriteShipmentFields } from '@/lib/shipments/store'
import { engineSendMedia } from '@/lib/flows/meta-send'
import { supabaseAdmin } from '@/lib/flows/admin-client'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * POST /api/contacts/[id]/shipment/photo
 *
 * Body: `{ media_url, caption? }` — `media_url` is a public URL
 * already uploaded to the `chat-media` bucket by the client (same
 * `uploadAccountMedia` helper the inbox composer uses). Sends it to
 * the customer as the Shalom receipt photo in one action, and
 * advances the shipment to `shipped` if it hadn't started yet —
 * replacing "open the chat, attach the photo, send it, then go
 * update a separate list" with a single click.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { id: contactId } = await params

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const mediaUrl = typeof body.media_url === 'string' ? body.media_url.trim() : ''
    if (!mediaUrl) return bad('media_url is required')
    const caption =
      typeof body.caption === 'string' && body.caption.trim()
        ? body.caption.trim()
        : '🧾 Aquí tienes tu boleta de envío Shalom.'

    const db = supabaseAdmin()
    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!conv) return bad('This contact has no conversation to send to yet')

    await engineSendMedia({
      accountId,
      userId,
      conversationId: conv.id,
      contactId,
      kind: 'image',
      link: mediaUrl,
      caption,
    })

    let shipment = await getOpenShipmentForContact(supabase, accountId, contactId)
    if (!shipment) {
      shipment = await overwriteShipmentFields(supabase, {
        accountId,
        contactId,
        createdBy: userId,
        patch: {},
      })
    }
    if (shipment) {
      const patch: Record<string, unknown> = { receipt_photo_url: mediaUrl }
      if (shipment.status === 'collecting' || shipment.status === 'ready') {
        patch.status = 'shipped'
      }
      await supabase.from('shipments').update(patch).eq('id', shipment.id)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
