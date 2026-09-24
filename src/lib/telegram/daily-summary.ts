import type { SupabaseClient } from '@supabase/supabase-js'
import { missingShipmentFields, type ShipmentRegion, type ShipmentStatus } from '@/lib/shipments/store'

/** Peru doesn't observe DST, so a fixed UTC-5 offset always gives the
 *  right calendar day — same approach as src/lib/ai/defaults.ts's
 *  time-of-day context. Returns the UTC instants bounding "today" in
 *  Lima. */
function limaDayBoundsUtc(now = new Date()): { start: Date; end: Date } {
  const limaNow = new Date(now.getTime() - 5 * 60 * 60 * 1000)
  const y = limaNow.getUTCFullYear()
  const m = limaNow.getUTCMonth()
  const d = limaNow.getUTCDate()
  // Midnight Lima time, converted back to the real UTC instant it is.
  const startUtc = new Date(Date.UTC(y, m, d, 5, 0, 0))
  const endUtc = new Date(Date.UTC(y, m, d + 1, 5, 0, 0))
  return { start: startUtc, end: endUtc }
}

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  collecting: 'Recolectando datos',
  ready: 'Listo para despachar',
  shipped: 'Enviado a agencia',
  at_agency: 'En agencia',
  out_for_delivery: 'En camino',
  delivered: 'Entregado',
}

interface ShipmentSummaryRow {
  id: string
  region: ShipmentRegion | null
  product: string | null
  city: string | null
  agency_name: string | null
  delivery_address: string | null
  recipient_name: string | null
  recipient_dni: string | null
  recipient_phone: string | null
  status: ShipmentStatus
  contacts: { name: string | null; phone: string | null } | null
}

function who(row: ShipmentSummaryRow): string {
  return row.contacts?.name?.trim() || row.contacts?.phone || 'contacto sin nombre'
}

/**
 * Builds the text for the "/resumen" Telegram command (migration 066) —
 * today's sales plus every open shipment, grouped by status, with
 * exactly what's still missing on each one still `collecting`. This is
 * the direct answer to orders shipping late because the product or a
 * recipient detail sat unfilled and nobody noticed: whoever runs
 * `/resumen` sees every gap in one message instead of having to open
 * each contact.
 */
export async function buildDailySummary(db: SupabaseClient, accountId: string): Promise<string> {
  const { start, end } = limaDayBoundsUtc()

  const [{ data: sales }, { data: shipments }] = await Promise.all([
    db
      .from('sales')
      .select('value, currency')
      .eq('account_id', accountId)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString()),
    db
      .from('shipments')
      .select(
        'id, region, product, city, agency_name, delivery_address, recipient_name, recipient_dni, recipient_phone, status, contacts(name, phone)',
      )
      .eq('account_id', accountId)
      .neq('status', 'delivered')
      .order('created_at', { ascending: true }),
  ])

  const lines: string[] = [`📋 Resumen del día`]

  const saleRows = (sales ?? []) as { value: number; currency: string }[]
  if (saleRows.length === 0) {
    lines.push('', '💰 Ventas hoy: ninguna todavía.')
  } else {
    const byCurrency = new Map<string, number>()
    for (const s of saleRows) {
      byCurrency.set(s.currency, (byCurrency.get(s.currency) ?? 0) + s.value)
    }
    const totals = [...byCurrency.entries()]
      .map(([currency, total]) => `${currency} ${total.toLocaleString()}`)
      .join(' + ')
    lines.push('', `💰 Ventas hoy: ${saleRows.length} (${totals})`)
  }

  const rows = (shipments ?? []) as unknown as ShipmentSummaryRow[]
  const collecting = rows.filter((r) => r.status === 'collecting')
  const rest = rows.filter((r) => r.status !== 'collecting')

  if (collecting.length > 0) {
    lines.push('', `⚠️ Pedidos con datos incompletos (${collecting.length}):`)
    for (const row of collecting) {
      const missing = missingShipmentFields(row).join(', ')
      lines.push(`• ${who(row)} — ${row.product ?? 'producto sin definir'} — falta: ${missing}`)
    }
  } else {
    lines.push('', '✅ Ningún pedido con datos pendientes.')
  }

  if (rest.length > 0) {
    lines.push('', '📦 Otros pedidos en curso:')
    for (const row of rest) {
      lines.push(`• ${who(row)} — ${row.product ?? '-'} — ${STATUS_LABELS[row.status]}`)
    }
  }

  return lines.join('\n')
}
