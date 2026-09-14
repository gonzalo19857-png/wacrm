import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Registers a sale for a contact that just got a "sale tag" (migration
 * 045) added to it. Inserts directly into the account's `sales` table —
 * a fast, one-field capture (price) at the moment the agent tags the
 * chat.
 */
export async function createSale(
  db: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    contactId: string;
    tagName: string;
    price: number;
    currency: string;
  },
): Promise<{ id: string } | null> {
  const { accountId, userId, contactId, tagName, price, currency } = args;

  const { data: contact } = await db
    .from('contacts')
    .select('name, phone')
    .eq('id', contactId)
    .maybeSingle();

  const who = contact?.name?.trim() || contact?.phone || 'contacto';

  const { data: sale, error } = await db
    .from('sales')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      title: `${tagName} — ${who}`,
      value: price,
      currency,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[sale-tag] failed to create sale:', error.message);
    return null;
  }

  return sale;
}
