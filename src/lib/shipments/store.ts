import type { SupabaseClient } from '@supabase/supabase-js'

export type ShipmentRegion = 'lima' | 'provincia'
export type ShipmentStatus =
  | 'collecting'
  | 'ready'
  | 'shipped'
  | 'at_agency'
  | 'out_for_delivery'
  | 'delivered'

export interface ShipmentRow {
  id: string
  account_id: string
  contact_id: string
  sale_id: string | null
  region: ShipmentRegion | null
  city: string | null
  agency_name: string | null
  agency_address: string | null
  delivery_address: string | null
  delivery_reference: string | null
  recipient_name: string | null
  recipient_dni: string | null
  recipient_phone: string | null
  receipt_photo_url: string | null
  notes: string | null
  status: ShipmentStatus
  created_at: string
  updated_at: string
}

/** Fields callers may patch — everything except the identity/audit
 *  columns and `status` (status has its own dedicated transition, see
 *  `applyStatusTransition`, so a stray patch can't skip a step
 *  silently). */
export type ShipmentPatch = Partial<
  Pick<
    ShipmentRow,
    | 'region'
    | 'city'
    | 'agency_name'
    | 'agency_address'
    | 'delivery_address'
    | 'delivery_reference'
    | 'recipient_name'
    | 'recipient_dni'
    | 'recipient_phone'
    | 'notes'
  >
>

const SELECT_COLUMNS =
  'id, account_id, contact_id, sale_id, region, city, agency_name, agency_address, ' +
  'delivery_address, delivery_reference, recipient_name, recipient_dni, recipient_phone, ' +
  'receipt_photo_url, notes, status, created_at, updated_at'

/**
 * The contact's current in-progress shipment (anything short of
 * `delivered`) — there's at most one at a time in practice, so "most
 * recent" is the right tiebreaker if that ever isn't true.
 */
export async function getOpenShipmentForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ShipmentRow | null> {
  const { data } = await db
    .from('shipments')
    .select(SELECT_COLUMNS)
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .neq('status', 'delivered')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as ShipmentRow | null) ?? null
}

/** True once a shipment has everything needed to actually be handed
 *  to Shalom (Provincia) or a courier (Lima). */
export function isShipmentReady(row: {
  region: ShipmentRegion | null
  city: string | null
  agency_name: string | null
  delivery_address: string | null
  recipient_name: string | null
  recipient_dni: string | null
  recipient_phone: string | null
}): boolean {
  if (row.region === 'provincia') {
    return !!(
      row.city && row.agency_name && row.recipient_name && row.recipient_dni && row.recipient_phone
    )
  }
  if (row.region === 'lima') {
    return !!(row.delivery_address && row.recipient_name && row.recipient_phone)
  }
  return false
}

/**
 * Create-or-merge the contact's open shipment with `patch`.
 *
 * `onlyFillBlanks` (used by the AI bot's sentinel and by the quick
 * region pick in the sale dialog) only writes a column that's
 * currently null/empty — it can add detail but never clobber a value
 * an agent already confirmed. An agent explicitly editing the
 * shipment panel passes `onlyFillBlanks: false` to overwrite freely,
 * since that's a deliberate correction.
 *
 * Returns the resulting row and whether this call is what pushed it
 * from `collecting` to `ready` (used to fire the one-time "ready to
 * pack" alert).
 */
export async function mergeShipmentFields(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    saleId?: string | null
    createdBy?: string | null
    patch: ShipmentPatch
  },
): Promise<{ row: ShipmentRow; becameReady: boolean } | null> {
  const { accountId, contactId, saleId, createdBy, patch } = args

  const existing = await getOpenShipmentForContact(db, accountId, contactId)

  if (!existing) {
    const insertRow: Record<string, unknown> = {
      account_id: accountId,
      contact_id: contactId,
      created_by: createdBy ?? null,
      ...patch,
    }
    if (saleId) insertRow.sale_id = saleId
    if (isShipmentReady({ region: patch.region ?? null, ...patch } as ShipmentRow)) {
      insertRow.status = 'ready'
    }
    const { data, error } = await db
      .from('shipments')
      .insert(insertRow)
      .select(SELECT_COLUMNS)
      .single()
    if (error || !data) {
      console.error('[shipments] create failed:', error)
      return null
    }
    const row = data as unknown as ShipmentRow
    return { row, becameReady: row.status === 'ready' }
  }

  const update: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = (existing as unknown as Record<string, unknown>)[key]
    const currentEmpty = current === null || current === undefined || current === ''
    update[key] = currentEmpty ? value : current
  }
  if (saleId && !existing.sale_id) update.sale_id = saleId

  const merged = { ...existing, ...update } as ShipmentRow
  const wasReady = existing.status !== 'collecting'
  if (!wasReady && isShipmentReady(merged)) {
    update.status = 'ready'
  }

  if (Object.keys(update).length === 0) {
    return { row: existing, becameReady: false }
  }

  const { data, error } = await db
    .from('shipments')
    .update(update)
    .eq('id', existing.id)
    .select(SELECT_COLUMNS)
    .single()
  if (error || !data) {
    console.error('[shipments] merge failed:', error)
    return null
  }
  const row = data as unknown as ShipmentRow
  return { row, becameReady: !wasReady && row.status === 'ready' }
}

/**
 * Agent-driven full overwrite of whichever fields are present in
 * `patch` (e.g. correcting a DNI the bot mis-heard) — unlike
 * `mergeShipmentFields`, this always writes the given value.
 * Creates the shipment if the contact has none open yet.
 */
export async function overwriteShipmentFields(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    shipmentId?: string | null
    saleId?: string | null
    createdBy?: string | null
    patch: ShipmentPatch
  },
): Promise<ShipmentRow | null> {
  const { accountId, contactId, shipmentId, saleId, createdBy, patch } = args

  let target: ShipmentRow | null = null
  if (shipmentId) {
    const { data } = await db
      .from('shipments')
      .select(SELECT_COLUMNS)
      .eq('id', shipmentId)
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()
    target = (data as ShipmentRow | null) ?? null
  } else {
    target = await getOpenShipmentForContact(db, accountId, contactId)
  }

  if (!target) {
    const insertRow: Record<string, unknown> = {
      account_id: accountId,
      contact_id: contactId,
      created_by: createdBy ?? null,
      ...patch,
    }
    if (saleId) insertRow.sale_id = saleId
    const { data, error } = await db
      .from('shipments')
      .insert(insertRow)
      .select(SELECT_COLUMNS)
      .single()
    if (error || !data) {
      console.error('[shipments] create (overwrite) failed:', error)
      return null
    }
    return data as unknown as ShipmentRow
  }

  const update: Record<string, unknown> = { ...patch }
  if (saleId && !target.sale_id) update.sale_id = saleId
  if (Object.keys(update).length === 0) return target

  const { data, error } = await db
    .from('shipments')
    .update(update)
    .eq('id', target.id)
    .select(SELECT_COLUMNS)
    .single()
  if (error || !data) {
    console.error('[shipments] overwrite failed:', error)
    return null
  }
  return data as unknown as ShipmentRow
}

const NEXT_STATUS_BY_REGION: Record<ShipmentRegion, ShipmentStatus[]> = {
  provincia: ['collecting', 'ready', 'shipped', 'at_agency', 'delivered'],
  lima: ['collecting', 'ready', 'out_for_delivery', 'delivered'],
}

/** Every status any shipment may be set to, regardless of region —
 *  used to validate the status transition API's input before it's
 *  known whether the row (and thus its region) exists. */
export const ALL_SHIPMENT_STATUSES: ShipmentStatus[] = [
  'collecting',
  'ready',
  'shipped',
  'at_agency',
  'out_for_delivery',
  'delivered',
]

/** Whether `status` is a valid step for `region`'s flow (Lima never
 *  goes through `shipped`/`at_agency`, Provincia never through
 *  `out_for_delivery`) — checked so the UI can only ever offer
 *  buttons that make sense for the order's own region. */
export function isValidStatusForRegion(
  region: ShipmentRegion | null,
  status: ShipmentStatus,
): boolean {
  if (!region) return status === 'collecting' || status === 'ready'
  return NEXT_STATUS_BY_REGION[region].includes(status)
}

export async function setShipmentStatus(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; shipmentId: string; status: ShipmentStatus },
): Promise<ShipmentRow | null> {
  const { data, error } = await db
    .from('shipments')
    .update({ status: args.status })
    .eq('id', args.shipmentId)
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .select(SELECT_COLUMNS)
    .single()
  if (error || !data) {
    console.error('[shipments] status update failed:', error)
    return null
  }
  return data as unknown as ShipmentRow
}
