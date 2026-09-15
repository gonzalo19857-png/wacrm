import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/settings/sale-sheet-webhook
 *
 * Any member may read it — the settings card needs to know whether
 * it's configured/active. The secret itself is never returned, only
 * whether one is stored.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('sale_sheet_webhooks')
      .select('webhook_url, secret, is_active')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[settings/sale-sheet-webhook GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load the sheet webhook' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ configured: false })
    return NextResponse.json({
      configured: true,
      webhook_url: data.webhook_url,
      has_secret: !!data.secret,
      is_active: data.is_active,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/settings/sale-sheet-webhook  (admin+)
 *
 * Upsert the account's Apps Script Web App URL + shared secret. The
 * secret follows the same "send only when re-entered, else keep the
 * stored one" contract as the AI provider key.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const webhookUrl = typeof body.webhook_url === 'string' ? body.webhook_url.trim() : ''
    if (!webhookUrl) return bad('webhook_url is required')
    try {
      new URL(webhookUrl)
    } catch {
      return bad('webhook_url must be a valid URL')
    }

    const rawSecret = typeof body.secret === 'string' ? body.secret.trim() : ''
    const isActive = body.is_active !== false

    const { data: existing } = await supabase
      .from('sale_sheet_webhooks')
      .select('id, secret')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!existing && !rawSecret) return bad('secret is required')

    const row: Record<string, unknown> = {
      account_id: accountId,
      webhook_url: webhookUrl,
      is_active: isActive,
    }
    if (rawSecret) row.secret = encrypt(rawSecret)

    if (existing) {
      const { error } = await supabase
        .from('sale_sheet_webhooks')
        .update(row)
        .eq('account_id', accountId)
      if (error) {
        console.error('[settings/sale-sheet-webhook POST] update error:', error)
        return NextResponse.json({ error: 'Failed to save the sheet webhook' }, { status: 500 })
      }
    } else {
      const { error } = await supabase.from('sale_sheet_webhooks').insert(row)
      if (error) {
        console.error('[settings/sale-sheet-webhook POST] insert error:', error)
        return NextResponse.json({ error: 'Failed to save the sheet webhook' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/settings/sale-sheet-webhook  (admin+)
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('sale_sheet_webhooks')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[settings/sale-sheet-webhook DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete the sheet webhook' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
