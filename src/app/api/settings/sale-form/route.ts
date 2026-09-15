import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/settings/sale-form
 *
 * Any member may read it — the Sales settings card needs to know
 * whether it's configured/active. Nothing here is a secret (a Google
 * Form response URL isn't a credential).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('sale_form_integrations')
      .select(
        'form_response_url, field_client_entry, field_product_entry, field_price_entry, field_phone_entry, is_active',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[settings/sale-form GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load the sale form integration' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })
    return NextResponse.json({ configured: true, ...data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/settings/sale-form  (admin+)
 *
 * Upsert the account's Google Form integration.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const formResponseUrl =
      typeof body.form_response_url === 'string' ? body.form_response_url.trim() : ''
    if (!formResponseUrl) return bad('form_response_url is required')
    try {
      new URL(formResponseUrl)
    } catch {
      return bad('form_response_url must be a valid URL')
    }

    const field = (key: string) =>
      typeof body[key] === 'string' && body[key].trim() ? body[key].trim() : null

    const row = {
      account_id: accountId,
      form_response_url: formResponseUrl,
      field_client_entry: field('field_client_entry'),
      field_product_entry: field('field_product_entry'),
      field_price_entry: field('field_price_entry'),
      field_phone_entry: field('field_phone_entry'),
      is_active: body.is_active !== false,
    }

    const { data: existing } = await supabase
      .from('sale_form_integrations')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('sale_form_integrations')
        .update(row)
        .eq('account_id', accountId)
      if (error) {
        console.error('[settings/sale-form POST] update error:', error)
        return NextResponse.json({ error: 'Failed to save the sale form integration' }, { status: 500 })
      }
    } else {
      const { error } = await supabase.from('sale_form_integrations').insert(row)
      if (error) {
        console.error('[settings/sale-form POST] insert error:', error)
        return NextResponse.json({ error: 'Failed to save the sale form integration' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/settings/sale-form  (admin+)
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('sale_form_integrations')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[settings/sale-form DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete the sale form integration' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
