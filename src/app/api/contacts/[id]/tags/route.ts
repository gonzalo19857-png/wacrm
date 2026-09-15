import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { createSale } from '@/lib/contacts/sale-tag';
import { pushSaleToGoogleForm } from '@/lib/contacts/sale-form';
import { loadAiConfig } from '@/lib/ai/config';
import { sendNewSaleTelegramAlert } from '@/lib/ai/handoff';
import {
  ContactTagWriteError,
  removeContactTag,
} from '@/lib/contacts/tag-write';

function tagWriteErrorResponse(error: ContactTagWriteError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: error.status });
}

async function readTagRequest(
  request: Request
): Promise<{ tagId: string | null; price: number | null }> {
  const body = (await request.json().catch(() => null)) as {
    tag_id?: unknown;
    price?: unknown;
  } | null;
  const tagId =
    typeof body?.tag_id === 'string' && body.tag_id.trim()
      ? body.tag_id.trim()
      : null;
  const price =
    typeof body?.price === 'number' && Number.isFinite(body.price) && body.price >= 0
      ? body.price
      : null;
  return { tagId, price };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const { tagId, price } = await readTagRequest(request);
    if (!tagId) {
      return NextResponse.json({ error: 'tag_id required' }, { status: 400 });
    }

    const result = await addContactTagAndDispatch({
      db: ctx.supabase,
      accountId: ctx.accountId,
      contactId,
      tagId,
    });

    // A "sale tag" (migration 045) registers a sale: fire only on a
    // genuine new add (never on a duplicate re-tag) and only when the
    // caller sent a price — the client is expected to have prompted
    // for it before calling this endpoint for a sale tag.
    let saleId: string | null = null;
    if (result.added && price !== null) {
      const { data: tag } = await ctx.supabase
        .from('tags')
        .select('name, is_sale_tag')
        .eq('id', tagId)
        .maybeSingle();
      if (tag?.is_sale_tag) {
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
        });
        saleId = sale?.id ?? null;

        // Fan out to whatever's configured — best-effort, never let a
        // notification/integration failure affect the response for a
        // sale that already saved.
        if (saleId) {
          const [aiConfig, { data: formConfig }, { data: saleContact }] = await Promise.all([
            loadAiConfig(ctx.supabase, ctx.accountId, { requireActive: false }),
            ctx.supabase
              .from('sale_form_integrations')
              .select(
                'form_response_url, field_client_entry, field_product_entry, field_price_entry, field_phone_entry, is_active',
              )
              .eq('account_id', ctx.accountId)
              .maybeSingle(),
            ctx.supabase.from('contacts').select('name, phone').eq('id', contactId).maybeSingle(),
          ]);

          if (aiConfig?.telegramNotifyOnSale && aiConfig.telegramBotToken && aiConfig.telegramChatId) {
            try {
              await sendNewSaleTelegramAlert(ctx.supabase, {
                telegramBotToken: aiConfig.telegramBotToken,
                telegramChatId: aiConfig.telegramChatId,
                contactId,
                title: `${tag.name}`,
                value: price,
                currency,
              });
            } catch (err) {
              console.error('[contacts/tags] sale Telegram alert failed:', err);
            }
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
                  title: tag.name,
                  value: price,
                  currency,
                  clientName: saleContact?.name?.trim() || saleContact?.phone || 'Contacto',
                  clientPhone: saleContact?.phone ?? '',
                },
              );
            } catch (err) {
              console.error('[contacts/tags] sale form push failed:', err);
            }
          }
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
