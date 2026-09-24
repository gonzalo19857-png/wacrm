import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getOpenShipmentForContact,
  mergeShipmentFields,
  type ShipmentPatch,
  type ShipmentRegion,
  type ShipmentRow,
} from '@/lib/shipments/store'
import { generateReply } from './generate'
import type { AiConfig, ChatMessage } from './types'

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

/** Values that are clearly an unfilled template placeholder rather than
 *  real customer data, rather than a value the model actually learned —
 *  e.g. the model echoing its own prompt's illustrative sentinel syntax
 *  (`name=<nombre completo>`, `dni=<dni>`) literally instead of
 *  substituting a real value. Seen live: `name=<nombre>` landing in the
 *  shipments table as the literal four-character string. Checked
 *  against every field, not just `name` — the same failure mode can
 *  hit any of them. */
const PLACEHOLDER_WORDS = new Set([
  'nombre',
  'nombre completo',
  'dni',
  'ciudad',
  'agencia',
  'direccion',
  'dirección',
  'telefono',
  'teléfono',
  'referencia',
  'producto',
  'modelo',
])
export function isPlaceholderValue(value: string): boolean {
  if (/[<>]/.test(value)) return true
  return PLACEHOLDER_WORDS.has(value.trim().toLowerCase())
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
      if (isPlaceholderValue(value)) continue
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

/** What `extractShipmentFieldsFromTranscript` looks for — the fields
 *  the shipment quick-form dialog (contact-sidebar.tsx's "Provincia"
 *  prompt) shows, so an agent doesn't have to scroll back through the
 *  chat by hand to find what the customer already said. */
export interface ShipmentAutofillFields {
  product: string | null
  name: string | null
  dni: string | null
  city: string | null
  agency: string | null
  phone: string | null
}

/**
 * Best-effort AI extraction of delivery data from a conversation
 * transcript — the fallback for what the DNI regex (extractDniFallback,
 * sale-sheet.ts) and the bot's own `[[SHIPMENT:...]]` sentinel can't
 * reliably get on their own: a recipient name or a named agency are
 * free text with no fixed pattern, and both are just as often given to
 * a HUMAN agent after handoff as to the bot itself — neither of which
 * a regex can safely parse. A single extraction call over the whole
 * transcript, rather than per-message regex, so it reads a name/DNI/
 * agency mentioned in any phrasing, in any message, by either party.
 *
 * Deliberately returns fields for the caller to offer as pre-filled
 * form values rather than writing them to the shipments row directly —
 * unlike the regex-based fallbacks, a model can misread a transcript,
 * so this stays a suggestion an agent confirms in the quick-form
 * dialog before it's saved, never a silent write.
 */
export async function extractShipmentFieldsFromTranscript(
  config: AiConfig,
  transcript: ChatMessage[],
): Promise<ShipmentAutofillFields | null> {
  if (transcript.length === 0) return null

  const transcriptText = transcript
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Vendedor'}: ${m.content}`)
    .join('\n')

  const systemPrompt = [
    'You extract structured delivery data from a WhatsApp sales conversation transcript (Spanish, Peru — a business selling vehicle covers, shipping via Shalom for Provincia orders).',
    'Read the ENTIRE transcript below and output ONLY a raw JSON object — no markdown code fences, no prose before or after — with exactly these keys: product, name, dni, city, agency, phone.',
    '- product: the exact vehicle/product name or model that was recommended or confirmed (e.g. "Kia Seltos", "mototaxi Bajaj Torito").',
    "- name: the recipient's full name, exactly as the customer themselves stated it — never a place, never the business's own name.",
    '- dni: the Peruvian DNI, exactly 8 digits — never a phone number (9 digits) or any other number that happens to appear.',
    '- city: the Peruvian city/province the order ships to (only relevant for a Provincia order).',
    '- agency: the Shalom agency (or delivery address) the customer named — copy what they actually said, never invent or guess one.',
    '- phone: a reference phone number, only if the customer explicitly gave one different from their own WhatsApp number.',
    'Use null (not an empty string, not a placeholder word) for any field you cannot find with real confidence — never guess, never invent, never fabricate a plausible-looking value.',
    '',
    'Transcript (Cliente = customer, Vendedor = the bot or a human agent):',
    transcriptText,
  ].join('\n')

  try {
    const result = await generateReply({
      config,
      systemPrompt,
      messages: [{ role: 'user', content: 'Devuelve el JSON ahora.' }],
    })

    const jsonText = result.text
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim()
    const parsed = JSON.parse(jsonText) as Record<string, unknown>

    const clean = (value: unknown): string | null => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      if (!trimmed || isPlaceholderValue(trimmed)) return null
      return trimmed
    }

    return {
      product: clean(parsed.product),
      name: clean(parsed.name),
      dni: clean(parsed.dni),
      city: clean(parsed.city),
      agency: clean(parsed.agency),
      phone: clean(parsed.phone),
    }
  } catch (err) {
    console.error('[shipment] AI autofill extraction failed:', err)
    return null
  }
}
