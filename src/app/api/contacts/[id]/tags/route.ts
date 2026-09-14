import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { createSaleDeal } from '@/lib/contacts/sale-tag';
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
    let dealId: string | null = null;
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
        const deal = await createSaleDeal(ctx.supabase, {
          accountId: ctx.accountId,
          userId: ctx.userId,
          contactId,
          tagName: tag.name,
          price,
          currency: account?.default_currency ?? 'USD',
        });
        dealId = deal?.id ?? null;
      }
    }

    return NextResponse.json({ ok: true, ...result, dealId });
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
