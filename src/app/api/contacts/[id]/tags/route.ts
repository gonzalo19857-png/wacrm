import { NextResponse, after } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { createSale } from '@/lib/contacts/sale-tag';
import { pushSaleToGoogleForm } from '@/lib/contacts/sale-form';
import { pushCreateSale, pushSetRegion } from '@/lib/contacts/sale-sheet';
import { sendNewSaleTelegramAlert } from '@/lib/ai/handoff';
import { mergeShipmentFields } from '@/lib/shipments/store';
import { clearLifecycleTagsOnSale } from '@/lib/contacts/lifecycle-tags';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  ContactTagWriteError,
  removeContactTag,
} from '@/lib/contacts/tag-write';

function tagWriteErrorResponse(error: ContactTagWriteError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: error.status });
}

async function readTagRequest(
  request: Request
): Promise<{
  tagId: string | null;
  price: number | null;
  fecha: string | null;
  region: 'lima' | 'provincia' | null;
}> {
  const body = (await request.json().catch(() => null)) as {
    tag_id?: unknown;
    price?: unknown;
    fecha?: unknown;
    region?: unknown;
  } | null;
  const tagId =
    typeof body?.tag_id === 'string' && body.tag_id.trim()
      ? body.tag_id.trim()
      : null;
  const price =
    typeof body?.price === 'number' && Number.isFinite(body.price) && body.price >= 0
      ? body.price
      : null;
  const fecha =
    typeof body?.fecha === 'string' && body.fecha.trim() ? body.fecha.trim() : null;
  const region = body?.region === 'lima' || body?.region === 'provincia' ? body.region : null;
  return { tagId, price, fecha, region };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const { tagId, price, fecha, region } = await readTagRequest(request);
    if (!tagId) {
      return NextResponse.json({ error: 'tag_id required' }, { status: 400 });
    }

    const result = await addContactTagAndDispatch({
      db: ctx.supabase,
      accountId: ctx.accountId,
      contactId,
      tagId,
    });

    // A "sale tag" (migration 045) registers a sale, and a "region
    // tag" (migration 050, e.g. "Lima" / "Provincia") pushes the
    // contact's region to the live sheet — both only on a genuine new
    // add (never on a duplicate re-tag).
    let saleId: string | null = null;
    if (result.added) {
      const { data: tag } = await ctx.supabase
        .from('tags')
        .select('name, is_sale_tag, region_value')
        .eq('id', tagId)
        .maybeSingle();

      if (tag?.region_value) {
        // Deferred (migration 066-adjacent latency fix): a Google Sheet
        // webhook push isn't needed for the response the agent's click
        // is waiting on — same reasoning as the sale fan-out below.
        // `after()` keeps the function alive for it regardless (see
        // src/app/api/whatsapp/webhook/route.ts for the same pattern);
        // a detached promise here could get frozen mid-flight.
        const regionValue = tag.region_value;
        after(async () => {
          try {
            const db = supabaseAdmin();
            const { data: regionContact } = await db
              .from('contacts')
              .select('phone')
              .eq('id', contactId)
              .maybeSingle();
            if (regionContact?.phone) {
              await pushSetRegion(db, ctx.accountId, {
                telefono: regionContact.phone,
                ciudad: regionValue,
              });
            }
          } catch (err) {
            console.error('[contacts/tags] region sheet push failed:', err);
          }
        });
      }

      if (tag?.is_sale_tag && price !== null) {
        const { data: account } = await ctx.supabase
          .from('accounts')
          .select('default_currency')
          .eq('id', ctx.accountId)
          .maybeSingle();
        const currency = account?.default_currency ?? 'USD';
        const sale = await createSale(ctx.supabase, {
          accountId: ctx.accountId,
          userId: ctx.userId,
          contactId,
          tagName: tag.name,
          price,
          currency,
          fecha: fecha ?? undefined,
        });
        saleId = sale?.id ?? null;
        const modelo = sale?.modelo ?? 'UNFOUND';

        // A closed sale means this contact is no longer "Potencial"
        // or "Caída" (migration 064) — clear both, best-effort.
        if (saleId) {
          await clearLifecycleTagsOnSale(ctx.supabase, ctx.accountId, contactId);
        }

        // A region picked right in the sale dialog (migration 052) —
        // just sets `region` on the contact's open shipment (creating
        // one if there isn't one yet) and links it to this sale. Never
        // overwrites a region the bot or a prior edit already set.
        // Best-effort: this is a convenience, not the sale itself.
        if (saleId && region) {
          try {
            await mergeShipmentFields(ctx.supabase, {
              accountId: ctx.accountId,
              contactId,
              saleId,
              createdBy: ctx.userId,
              patch: { region },
            });
          } catch (err) {
            console.error('[contacts/tags] shipment region link failed:', err);
          }
        }

        // Fan out to whatever's configured — deferred past the response
        // (migration 066-adjacent latency fix). None of this — the
        // Google Sheet push, the Telegram alert, the Google Form push —
        // is needed for the "Register" button's response, and each is
        // its own external network round trip (the Sheet one especially:
        // an Apps Script webhook, notoriously slow to wake from cold).
        // Best-effort either way: never let a notification/integration
        // failure affect a sale that already saved.
        if (saleId) {
          const tagName = tag.name;
          after(async () => {
            const db = supabaseAdmin();
            const [{ data: formConfig }, { data: saleContact }] = await Promise.all([
              db
                .from('sale_form_integrations')
                .select(
                  'form_response_url, field_client_entry, field_product_entry, field_price_entry, field_phone_entry, is_active',
                )
                .eq('account_id', ctx.accountId)
                .maybeSingle(),
              db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle(),
            ]);
            const who = saleContact?.name?.trim() || saleContact?.phone || 'Contacto';

            if (fecha && saleContact?.phone) {
              try {
                await pushCreateSale(db, ctx.accountId, {
                  fecha,
                  cliente: who,
                  telefono: saleContact.phone,
                  modelo,
                  precio_venta: price,
                });
              } catch (err) {
                console.error('[contacts/tags] sheet push failed:', err);
              }
            }

            try {
              await sendNewSaleTelegramAlert(db, {
                accountId: ctx.accountId,
                contactId,
                title: tagName,
                value: price,
                currency,
              });
            } catch (err) {
              console.error('[contacts/tags] sale Telegram alert failed:', err);
            }

            if (formConfig?.is_active && formConfig.form_response_url) {
              try {
                await pushSaleToGoogleForm(
                  {
                    formResponseUrl: formConfig.form_response_url,
                    fieldClientEntry: formConfig.field_client_entry,
                    fieldProductEntry: formConfig.field_product_entry,
                    fieldPriceEntry: formConfig.field_price_entry,
                    fieldPhoneEntry: formConfig.field_phone_entry,
                  },
                  {
                    title: tagName,
                    value: price,
                    currency,
                    clientName: who,
                    clientPhone: saleContact?.phone ?? '',
                  },
                );
              } catch (err) {
                console.error('[contacts/tags] sale form push failed:', err);
              }
            }
          });
        }
      }
    }

    return NextResponse.json({ ok: true, ...result, saleId });
  } catch (error) {
    if (error instanceof ContactTagWriteError) {
      return tagWriteErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const { tagId } = await readTagRequest(request);
    if (!tagId) {
      return NextResponse.json({ error: 'tag_id required' }, { status: 400 });
    }

    await removeContactTag(ctx.supabase, {
      accountId: ctx.accountId,
      contactId,
      tagId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ContactTagWriteError) {
      return tagWriteErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}
