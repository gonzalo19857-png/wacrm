import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/settings/shalom-agencies
 *
 * Any member may read the list — it's the reference data the AI bot
 * (migration 052) and the settings admin UI both read from.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('shalom_agencies')
      .select('id, city, name, address, reference, is_active, created_at')
      .eq('account_id', accountId)
      .order('city', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      console.error('[settings/shalom-agencies GET] error:', error)
      return NextResponse.json({ error: 'Failed to load Shalom agencies' }, { status: 500 })
    }
    return NextResponse.json({ agencies: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/settings/shalom-agencies  (admin+)
 *
 * Registers one Shalom agency for a city. This is the data source the
 * AI auto-reply bot lists to a Provincia customer instead of a human
 * screenshotting Shalom's own locator — so it's deliberately
 * admin-entered/verified rather than anything the model infers.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const city = typeof body.city === 'string' ? body.city.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const address = typeof body.address === 'string' ? body.address.trim() : ''
    const reference = typeof body.reference === 'string' ? body.reference.trim() : null

    if (!city) return bad('city is required')
    if (!name) return bad('name is required')
    if (!address) return bad('address is required')

    const { data, error } = await supabase
      .from('shalom_agencies')
      .insert({
        account_id: accountId,
        city,
        name,
        address,
        reference: reference || null,
        is_active: body.is_active !== false,
      })
      .select('id, city, name, address, reference, is_active, created_at')
      .single()

    if (error) {
      console.error('[settings/shalom-agencies POST] error:', error)
      return NextResponse.json({ error: 'Failed to create the agency' }, { status: 500 })
    }
    return NextResponse.json({ agency: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
