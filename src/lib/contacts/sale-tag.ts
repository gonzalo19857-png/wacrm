import type { SupabaseClient } from '@supabase/supabase-js';
import { extractVehicleModel, extractDniFallback } from './sale-sheet';
import { mergeShipmentFields, type ShipmentPatch } from '@/lib/shipments/store';

/**
 * Registers a sale for a contact that just got a "sale tag" (migration
 * 045) added to it. Inserts directly into the account's `sales` table —
 * a fast, one-field capture (price) at the moment the agent tags the
 * chat.
 *
 * Also identifies the vehicle model and a fallback DNI from the
 * contact's most recent conversation (best-effort, all local/DB work —
 * fast) and seeds them onto the contact's open shipment record. Returns
 * `modelo` so the caller can push it to the account's live Google Sheet
 * (migration 050) itself — deliberately NOT done here: that's a slow
 * external webhook call (Apps Script), and this function is on the
 * critical path of the "Register" button the agent is waiting on.
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
    fecha?: string;
  },
): Promise<{ id: string; modelo: string } | null> {
  const { accountId, userId, contactId, tagName, price, currency, fecha } = args;

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

  let modelo = 'UNFOUND';
  if (fecha && contact?.phone) {
    try {
      const { data: conv } = await db
        .from('conversations')
        .select('id')
        .eq('contact_id', contactId)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (conv) {
        const { data: messages } = await db
          .from('messages')
          .select('content_text, sender_type')
          .eq('conversation_id', conv.id)
          .not('content_text', 'is', null)
          .order('created_at', { ascending: false })
          .limit(30);
        const rows = messages ?? [];
        const texts = rows
          .map((m: { content_text: string | null }) => m.content_text)
          .filter((t: string | null): t is string => !!t);
        modelo = extractVehicleModel(texts);

        // Best-effort: seed the shipment record's `product` (migration
        // 066) and `recipient_dni` with what's already sitting in the
        // conversation, so dispatch never sees a "ready" order without
        // knowing what to pack or who to hand it to — this covers not
        // just the AI bot's own [[SHIPMENT:...]] sentinel (which only
        // fires while the bot itself is replying) but also a DNI the
        // customer gave a HUMAN agent in plain chat after a handoff,
        // which nothing else captures into the structured record.
        // `onlyFillBlanks` (mergeShipmentFields' default) never
        // overwrites a value already set.
        const customerTexts = rows
          .filter((m: { sender_type: string | null }) => m.sender_type === 'customer')
          .map((m: { content_text: string | null }) => m.content_text)
          .filter((t: string | null): t is string => !!t);
        const dniFallback = extractDniFallback(customerTexts);

        const patch: ShipmentPatch = {};
        if (modelo !== 'UNFOUND') patch.product = modelo;
        if (dniFallback) patch.recipient_dni = dniFallback;
        if (Object.keys(patch).length > 0) {
          try {
            await mergeShipmentFields(db, {
              accountId,
              contactId,
              saleId: sale.id,
              createdBy: userId,
              patch,
            });
          } catch (err) {
            console.error('[sale-tag] shipment product/dni fill failed:', err);
          }
        }
      }
    } catch (err) {
      console.error('[sale-tag] model/DNI lookup failed:', err);
    }
  }

  return { id: sale.id, modelo };
}
