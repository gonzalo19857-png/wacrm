import { supabaseAdmin } from './admin-client'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConversationRow = any

interface ConversationOutcome {
  conversation: ConversationRow
  /** True when this call created the row. */
  created: boolean
}

/**
 * Find or create the single conversation for a (account, contact) pair.
 * Channel-agnostic — originally lived inline in the WhatsApp webhook
 * route, extracted so the Messenger webhook can share it too.
 *
 * We deliberately do NOT use `.single()` on the lookup. `.single()`
 * errors on both 0 rows and ≥2 rows, and treating any error as "none
 * found" would insert a new row every time two conversations already
 * exist for a contact (from a race — a retried delivery, or a batch
 * fanning out to concurrent runs), snowballing into a wall of
 * duplicate chats (issue #363).
 *
 * Ordering oldest-first and taking one row resolves to the same
 * canonical survivor the dedup migration (036) keeps, so any
 * pre-existing duplicates converge instead of compounding.
 */
export async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  channel: 'whatsapp' | 'messenger' = 'whatsapp',
): Promise<ConversationOutcome | null> {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('Error finding conversation:', findError)
    return null
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  // Create new conversation. account_id is the tenancy column;
  // user_id is the NOT NULL FK audit column (no inbound message has a
  // single "user who created" it — attributed to the channel config's
  // owner as a stable default).
  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
      channel,
    })
    .select()
    .single()

  if (createError) {
    // Lost a race: a concurrent inbound delivery created the
    // conversation between our lookup and insert, and the unique index
    // (migration 036) rejected the duplicate. Re-resolve the winning
    // row instead of dropping the message.
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false }
      }
    }
    console.error('Error creating conversation:', createError)
    return null
  }

  return { conversation: newConv, created: true }
}
