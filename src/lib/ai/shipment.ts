import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getOpenShipmentForContact,
  mergeShipmentFields,
  type ShipmentPatch,
  type ShipmentRegion,
  type ShipmentRow,
} from '@/lib/shipments/store'

export interface ParsedShipmentFields {
  region: ShipmentRegion | null
  product: string | null
  city: string | null
  agency: string | null
  name: string | null
  dni: string | null
  phone: string | null
  address: string | null
  reference: string | null
  /** Free-text extras that don't fit another column — e.g. a Lima
   *  same-day/next-day delivery slot the customer picked. */
  notes: string | null
}

const EMPTY_FIELDS: ParsedShipmentFields = {
  region: null,
  product: null,
  city: null,
  agency: null,
  name: null,
  dni: null,
  phone: null,
  address: null,
  reference: null,
  notes: null,
}

/**
 * Parse the raw contents of a `[[SHIPMENT:...]]` sentinel (see
 * defaults.ts) — `key=value` pairs separated by `;`, e.g.
 * `region=provincia;city=Arequipa;agency=Shalom Mercaderes;name=Juan
 * Perez;dni=12345678;phone=987654321`. Unknown keys and malformed
 * pairs are silently dropped rather than throwing — the model's
 * output is untrusted formatting, not a contract to enforce strictly.
 * Pure, so it's unit-testable without touching the DB.
 */
export function parseShipmentSentinel(raw: string): ParsedShipmentFields {
  const fields: ParsedShipmentFields = { ...EMPTY_FIELDS }
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = pair.slice(0, eq).trim().toLowerCase()
    const value = pair.slice(eq + 1).trim()
    if (!value) continue
    if (key === 'region') {
      const v = value.toLowerCase()
      if (v === 'lima' || v === 'provincia') fields.region = v
      continue
    }
    if (key in fields) {
      ;(fields as unknown as Record<string, string | null>)[key] = value
    }
  }

  // Sanity check: a recipient name should never actually be a place.
  // Catches the model occasionally mismapping a multi-line customer
  // message (e.g. "NOMBRE=Juan Perez / LUGAR=Sullana (Piura)") — seen
  // live once, with the city landing in `name` instead of the actual
  // name. Cheap and deliberately narrow: only drops `name` when it's
  // clearly not a person (a parenthetical annotation, or it literally
  // contains the city just parsed) — never touches a name that's just
  // unusual-looking.
  if (fields.name) {
    const looksLikeAPlace =
      /[()]/.test(fields.name) ||
      (fields.city !== null && fields.name.toLowerCase().includes(fields.city.toLowerCase()))
    if (looksLikeAPlace) fields.name = null
  }

  return fields
}

function toPatch(fields: ParsedShipmentFields): ShipmentPatch {
  const patch: ShipmentPatch = {}
  if (fields.region) patch.region = fields.region
  if (fields.product) patch.product = fields.product
  if (fields.city) patch.city = fields.city
  if (fields.agency) patch.agency_name = fields.agency
  if (fields.name) patch.recipient_name = fields.name
  if (fields.dni) patch.recipient_dni = fields.dni
  if (fields.phone) patch.recipient_phone = fields.phone
  if (fields.address) patch.delivery_address = fields.address
  if (fields.reference) patch.delivery_reference = fields.reference
  if (fields.notes) patch.notes = fields.notes
  return patch
}

/**
 * Persist the delivery details a `[[SHIPMENT:...]]` sentinel carried
 * this turn. Only fills blank fields on the contact's open shipment
 * (creating one if there isn't one yet) — an agent's own edits in the
 * shipment panel are never clobbered by a later bot turn. Returns
 * whether this call is what completed the record (useful for firing
 * the "ready to pack" alert exactly once).
 */
export async function upsertShipmentFromSentinel(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    fields: ParsedShipmentFields
    /** The contact's own WhatsApp number — the model's context never
     *  contains raw phone digits (only message text), so it can
     *  never fill `phone=` in the sentinel unless the customer typed
     *  a different number in chat. Defaulting here (fillBlanksOnly,
     *  so an explicit sentinel value or an agent's edit always wins)
     *  is what actually gets `recipient_phone` populated in practice. */
    contactPhone?: string | null
  },
): Promise<{ row: ShipmentRow; becameReady: boolean } | null> {
  const patch = toPatch(args.fields)
  if (args.contactPhone && !patch.recipient_phone) {
    patch.recipient_phone = args.contactPhone
  }
  if (Object.keys(patch).length === 0) return null
  return mergeShipmentFields(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    patch,
  })
}

/**
 * A short, model-readable summary of the contact's current shipment
 * (if any) to fold into the system prompt — so the bot doesn't re-ask
 * for fields it already has, and can answer "¿ya llegó mi pedido?"
 * from `status` without a human. Null when the contact has no
 * in-progress shipment.
 */
export async function getShipmentStatusContext(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  try {
    const row = await getOpenShipmentForContact(db, accountId, contactId)
    if (!row) return null

    const lines = [`region=${row.region ?? 'unknown'}`, `status=${row.status}`]
    if (row.product) lines.push(`product=${row.product}`)
    if (row.city) lines.push(`city=${row.city}`)
    if (row.agency_name) lines.push(`agency=${row.agency_name}`)
    if (row.delivery_address) lines.push(`address=${row.delivery_address}`)
    if (row.delivery_reference) lines.push(`reference=${row.delivery_reference}`)
    if (row.recipient_name) lines.push(`name=${row.recipient_name}`)
    if (row.recipient_dni) lines.push(`dni=${row.recipient_dni}`)
    if (row.recipient_phone) lines.push(`phone=${row.recipient_phone}`)
    if (row.notes) lines.push(`notes=${row.notes}`)
    return lines.join('; ')
  } catch (err) {
    console.error('[shipment] status context lookup failed:', err)
    return null
  }
}
