import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { pushAppendNote } from '@/lib/contacts/sale-sheet';

/**
 * POST /api/contacts/[id]/notes  (agent+)
 *
 * Saves a contact note. Moved here from the two inline client-side
 * `supabase.from('contact_notes').insert(...)` calls (inbox sidebar +
 * Contacts page) so the note can also best-effort push to the
 * account's live sheet (migration 050) — that push needs the shared
 * secret, which must stay server-side.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const body = await request.json().catch(() => null);
    const noteText = typeof body?.note_text === 'string' ? body.note_text.trim() : '';
    if (!noteText) {
      return NextResponse.json({ error: 'note_text is required' }, { status: 400 });
    }

    const { data: note, error } = await ctx.supabase
      .from('contact_notes')
      .insert({
        contact_id: contactId,
        account_id: ctx.accountId,
        user_id: ctx.userId,
        note_text: noteText,
      })
      .select()
      .single();

    if (error) {
      console.error('[contacts/notes] insert error:', error);
      return NextResponse.json({ error: 'Failed to save note' }, { status: 500 });
    }

    try {
      const { data: contact } = await ctx.supabase
        .from('contacts')
        .select('phone')
        .eq('id', contactId)
        .maybeSingle();
      if (contact?.phone) {
        await pushAppendNote(ctx.supabase, ctx.accountId, {
          telefono: contact.phone,
          note: noteText,
        });
      }
    } catch (err) {
      console.error('[contacts/notes] sheet push failed:', err);
    }

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
