import { supabaseAdmin } from '@/lib/automations/admin-client'
import { engineSendTemplate } from '@/lib/automations/meta-send'

/** Mirrors automations/engine.ts's resolveConversationId (not exported
 *  from there) — a recontact can only be scheduled from an existing
 *  conversation (the tag is applied from the Inbox or Contacts, both
 *  already showing one), so there's nothing to find-or-create here. */
async function resolveConversationId(accountId: string, contactId: string): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (error) throw new Error(`conversation lookup failed: ${error.message}`)
  if (!data?.id) throw new Error('contact has no existing conversation')
  return data.id as string
}

/**
 * Claim and send every `contact_scheduled_messages` row whose `send_at`
 * has passed (migration 077 — the "pick a date" recontact flow). Same
 * claim-then-process shape as drainDuePendingExecutions
 * (src/lib/automations/engine.ts): an optimistic UPDATE-by-id guards
 * against double-send if two ticks overlap.
 */
export async function drainDueScheduledMessages(limit = 50): Promise<number> {
  const db = supabaseAdmin()
  const { data: due, error } = await db
    .from('contact_scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('send_at', new Date().toISOString())
    .order('send_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[contacts] scheduled-messages drain: query failed', error)
    return 0
  }
  if (!due || due.length === 0) return 0

  let processed = 0
  for (const row of due) {
    const { data: claim } = await db
      .from('contact_scheduled_messages')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      const conversationId = await resolveConversationId(
        row.account_id as string,
        row.contact_id as string,
      )
      await engineSendTemplate({
        accountId: row.account_id as string,
        userId: row.user_id as string,
        conversationId,
        contactId: row.contact_id as string,
        templateName: row.template_name as string,
        language: row.template_language as string,
        params: (row.template_params as string[] | null) ?? [],
      })
      await db.from('contact_scheduled_messages').update({ status: 'sent' }).eq('id', row.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[contacts] scheduled-message send failed:', row.id, message)
      await db
        .from('contact_scheduled_messages')
        .update({ status: 'failed', error: message })
        .eq('id', row.id)
    }
    processed++
  }
  return processed
}
