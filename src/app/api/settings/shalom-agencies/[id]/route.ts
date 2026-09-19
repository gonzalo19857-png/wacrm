import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * PATCH /api/settings/shalom-agencies/[id]  (admin+)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const update: Record<string, unknown> = {}
    if ('city' in body) {
      const city = typeof body.city === 'string' ? body.city.trim() : ''
      if (!city) return bad('city cannot be empty')
      update.city = city
    }
    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return bad('name cannot be empty')
      update.name = name
    }
    if ('address' in body) {
      const address = typeof body.address === 'string' ? body.address.trim() : ''
      if (!address) return bad('address cannot be empty')
      update.address = address
    }
    if ('reference' in body) {
      update.reference = typeof body.reference === 'string' ? body.reference.trim() || null : null
    }
    if ('is_active' in body) {
      update.is_active = body.is_active === true
    }

    if (Object.keys(update).length === 0) return NextResponse.json({ ok: true })

    const { error } = await supabase
      .from('shalom_agencies')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) {
      console.error('[settings/shalom-agencies PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update the agency' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/settings/shalom-agencies/[id]  (admin+)
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await params

    const { error } = await supabase
      .from('shalom_agencies')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) {
      console.error('[settings/shalom-agencies DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete the agency' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
