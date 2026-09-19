import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  ALL_SHIPMENT_STATUSES,
  getOpenShipmentForContact,
  isValidStatusForRegion,
  setShipmentStatus,
  type ShipmentRow,
  type ShipmentStatus,
} from '@/lib/shipments/store'
import { engineSendText } from '@/lib/flows/meta-send'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { pushUpdateShipment, SHIPMENT_STATUS_LABELS } from '@/lib/contacts/sale-sheet'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/** The customer-facing WhatsApp text for each status transition an
 *  agent can trigger with one click — null means "no message for
 *  this one" (e.g. `ready` is an internal milestone, nothing to tell
 *  the customer yet). */
function notificationText(row: ShipmentRow, status: ShipmentStatus): string | null {
  switch (status) {
    case 'shipped':
      return row.region === 'provincia'
        ? `📦 Tu pedido ya fue enviado a la agencia Shalom${row.city ? ` de ${row.city}` : ''}. Te avisamos apenas esté disponible para recoger.`
        : null
    case 'at_agency':
      return `📦 ¡Tu pedido ya llegó a la agencia Shalom${row.agency_name ? ` ${row.agency_name}` : ''}${
        row.city ? ` (${row.city})` : ''
      }! Puedes recogerlo presentando tu DNI.`
    case 'out_for_delivery':
      return '🚚 Tu pedido está en camino. Nos pondremos en contacto contigo al llegar.'
    case 'delivered':
      return '✅ Confirmamos la entrega de tu pedido. ¡Gracias por tu compra!'
    default:
      return null
  }
}

/**
 * POST /api/contacts/[id]/shipment/status
 *
 * Body: `{ status, notify?: boolean }`. Advances the contact's open
 * shipment to `status` and, unless `notify: false` is explicitly
 * passed, sends the matching WhatsApp update to the customer — the
 * one-click replacement for manually typing "ya llegó a la agencia"
 * every time.
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

    const status = body.status as ShipmentStatus
    if (!ALL_SHIPMENT_STATUSES.includes(status)) {
      return bad(`status must be one of: ${ALL_SHIPMENT_STATUSES.join(', ')}`)
    }
    const notify = body.notify !== false

    const current = await getOpenShipmentForContact(supabase, accountId, contactId)
    if (!current) return bad('This contact has no shipment on file yet')
    if (!isValidStatusForRegion(current.region, status)) {
      return bad(`"${status}" isn't a valid status for a ${current.region ?? 'unset-region'} shipment`)
    }

    const updated = await setShipmentStatus(supabase, {
      accountId,
      contactId,
      shipmentId: current.id,
      status,
    })
    if (!updated) {
      return NextResponse.json({ error: 'Failed to update the shipment status' }, { status: 500 })
    }

    try {
      const { data: statusContact } = await supabase
        .from('contacts')
        .select('phone')
        .eq('id', contactId)
        .maybeSingle()
      if (statusContact?.phone) {
        await pushUpdateShipment(supabase, accountId, {
          telefono: statusContact.phone,
          estado: SHIPMENT_STATUS_LABELS[status] ?? status,
        })
      }
    } catch (err) {
      console.error('[shipment status] sheet push failed:', err)
    }

    let notified = false
    const text = notify ? notificationText(updated, status) : null
    if (text) {
      try {
        const db = supabaseAdmin()
        const { data: conv } = await db
          .from('conversations')
          .select('id')
          .eq('contact_id', contactId)
          .order('last_message_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (conv) {
          await engineSendText({
            accountId,
            userId,
            conversationId: conv.id,
            contactId,
            text,
          })
          notified = true
        }
      } catch (err) {
        console.error('[shipment status] WhatsApp notify failed:', err)
      }
    }

    return NextResponse.json({ shipment: updated, notified })
  } catch (err) {
    return toErrorResponse(err)
  }
}
