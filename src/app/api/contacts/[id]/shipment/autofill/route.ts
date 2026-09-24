import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { extractShipmentFieldsFromTranscript } from '@/lib/ai/shipment'

/**
 * POST /api/contacts/[id]/shipment/autofill
 *
 * Reads the contact's most recent conversation and asks the account's
 * own configured AI provider to pull out whatever delivery data (the
 * product, recipient name/DNI, city, agency) is sitting in the chat —
 * the shipment quick-form dialog calls this when it opens with fields
 * still blank, so an agent doesn't have to leave the dialog and scroll
 * back through the thread by hand to find what the customer already
 * said (including to a human agent after handoff, which the bot's own
 * sentinel never sees). Returns suggestions only — nothing is written
 * to the shipment record here; the dialog pre-fills its inputs and the
 * agent still confirms via the normal Save.
 *
 * `requireActive: false` — this is a deliberate one-off utility call,
 * independent of whether auto-reply itself is currently toggled on.
 * Silently returns null fields (never an error) when the account has
 * no AI provider configured, or the extraction fails — this is a
 * convenience on top of manual entry, never a blocker to it.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id: contactId } = await params

    const config = await loadAiConfig(supabase, accountId, { requireActive: false })
    if (!config) return NextResponse.json({ fields: null })

    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!conv) return NextResponse.json({ fields: null })

    const transcript = await buildConversationContext(supabase, conv.id)
    const fields = await extractShipmentFieldsFromTranscript(config, transcript)

    return NextResponse.json({ fields })
  } catch (err) {
    return toErrorResponse(err)
  }
}
