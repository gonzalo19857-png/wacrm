import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  getOpenShipmentForContact,
  overwriteShipmentFields,
  type ShipmentPatch,
} from '@/lib/shipments/store'
import { pushUpdateShipment } from '@/lib/contacts/sale-sheet'
import { sendShipmentReadyTelegramAlert } from '@/lib/ai/handoff'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/contacts/[id]/shipment
 *
 * The contact's current in-progress shipment (migration 052) — what
 * the AI bot has collected so far via the `[[SHIPMENT:...]]`
 * sentinel, and/or what an agent has entered by hand. Null when there
 * isn't one yet.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id: contactId } = await params
    const shipment = await getOpenShipmentForContact(supabase, accountId, contactId)
    return NextResponse.json({ shipment })
  } catch (err) {
    return toErrorResponse(err)
  }
}

const TEXT_FIELDS = [
  'product',
  'city',
  'agency_name',
  'agency_address',
  'delivery_address',
  'delivery_reference',
  'recipient_name',
  'recipient_dni',
  'recipient_phone',
  'notes',
] as const

/**
 * PATCH /api/contacts/[id]/shipment
 *
 * An agent correcting or filling in delivery data by hand — always
 * overwrites the given fields (unlike the bot's own sentinel merge,
 * which only fills blanks), since this is a deliberate edit.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { id: contactId } = await params

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const patch: ShipmentPatch = {}
    if ('region' in body) {
      if (body.region !== 'lima' && body.region !== 'provincia' && body.region !== null) {
        return bad('region must be "lima", "provincia", or null')
      }
      patch.region = body.region
    }
    for (const key of TEXT_FIELDS) {
      if (key in body) {
        const value = body[key]
        if (value !== null && typeof value !== 'string') return bad(`${key} must be a string or null`)
        patch[key] = typeof value === 'string' ? value.trim() || null : null
      }
    }

    const shipmentId = typeof body.shipment_id === 'string' ? body.shipment_id : null
    const saleId = typeof body.sale_id === 'string' ? body.sale_id : null

    const result = await overwriteShipmentFields(supabase, {
      accountId,
      contactId,
      shipmentId,
      saleId,
      createdBy: userId,
      patch,
    })
    if (!result) {
      return NextResponse.json({ error: 'Failed to save the shipment' }, { status: 500 })
    }
    const { row: shipment, becameReady } = result

    try {
      const { data: patchContact } = await supabase
        .from('contacts')
        .select('phone')
        .eq('id', contactId)
        .maybeSingle()
      if (patchContact?.phone) {
        await pushUpdateShipment(supabase, accountId, {
          telefono: patchContact.phone,
          ciudad: shipment.city,
          direccion: shipment.delivery_address,
          agencia: shipment.agency_name,
          dni: shipment.recipient_dni,
          modelo: shipment.product,
          nombre: shipment.recipient_name,
        })
      }
    } catch (err) {
      console.error('[shipment PATCH] sheet push failed:', err)
    }

    if (becameReady) {
      try {
        await sendShipmentReadyTelegramAlert(supabase, {
          accountId,
          contactId,
          shipment: {
            region: shipment.region,
            product: shipment.product,
            city: shipment.city,
            agencyName: shipment.agency_name,
            deliveryAddress: shipment.delivery_address,
            deliveryReference: shipment.delivery_reference,
            recipientName: shipment.recipient_name,
            recipientDni: shipment.recipient_dni,
            recipientPhone: shipment.recipient_phone,
          },
        })
      } catch (err) {
        console.error('[shipment PATCH] Telegram alert failed:', err)
      }
    }

    return NextResponse.json({ shipment })
  } catch (err) {
    return toErrorResponse(err)
  }
}
