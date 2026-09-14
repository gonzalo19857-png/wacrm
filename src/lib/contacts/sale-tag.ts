import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Registers a sale for a contact that just got a "sale tag" (migration
 * 045) added to it. Drops the deal into the account's first pipeline /
 * first stage — which pipeline stage a sale starts in isn't something
 * this flow tries to get right, since the whole point is a fast,
 * one-field capture (price) at the moment the agent tags the chat, not
 * a full deal-editing form. The agent can move the stage afterward if
 * they use the pipeline board.
 */
export async function createSaleDeal(
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

  const [{ data: contact }, { data: pipeline }] = await Promise.all([
    db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle(),
    db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!pipeline) {
    console.error(
      `[sale-tag] account ${accountId} has no pipeline — can't file the "${tagName}" sale as a deal.`,
    );
    return null;
  }

  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipeline.id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!stage) {
    console.error(
      `[sale-tag] pipeline ${pipeline.id} has no stages — can't file the "${tagName}" sale as a deal.`,
    );
    return null;
  }

  const who = contact?.name?.trim() || contact?.phone || 'contacto';

  const { data: deal, error } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: userId,
      pipeline_id: pipeline.id,
      stage_id: stage.id,
      contact_id: contactId,
      title: `${tagName} — ${who}`,
      value: price,
      currency,
      status: 'open',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[sale-tag] failed to create deal:', error.message);
    return null;
  }

  return deal;
}
