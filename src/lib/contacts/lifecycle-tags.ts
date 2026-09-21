import type { SupabaseClient } from '@supabase/supabase-js';

import { addContactTagAndDispatch } from './tag-events';
import { removeContactTag } from './tag-write';

/**
 * Auto-apply the account's "Potencial" tag(s) — any tag with
 * `is_potential_tag = true` (migration 064) — to a contact the AI bot
 * just told the payment methods (`[[STAGE:MEDIOS_PAGO]]`, see
 * `src/lib/ai/defaults.ts`). No-ops when the account hasn't opted any
 * tag into that role, and skips a contact that already has a sale tag
 * (`is_sale_tag`) — a returning customer asking about payment again
 * shouldn't get demoted back to "Potencial". Best-effort: never
 * throws, mirroring every other sentinel side-effect in auto-reply.ts.
 */
export async function applyPotentialTag(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  try {
    // Two plain queries rather than an embedded FK join — this
    // codebase has been burned before by `!inner` embeds failing hard
    // on a stale PostgREST schema cache right after a migration
    // (see the comment in `src/lib/auth/account.ts`).
    const { data: contactTags } = await db
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', contactId);
    const contactTagIds = (contactTags ?? []).map((t: { tag_id: string }) => t.tag_id);

    if (contactTagIds.length > 0) {
      const { data: existingSaleTag } = await db
        .from('tags')
        .select('id')
        .eq('account_id', accountId)
        .eq('is_sale_tag', true)
        .in('id', contactTagIds)
        .limit(1)
        .maybeSingle();
      if (existingSaleTag) return;
    }

    const { data: potentialTags } = await db
      .from('tags')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_potential_tag', true);
    if (!potentialTags || potentialTags.length === 0) return;

    for (const tag of potentialTags as { id: string }[]) {
      await addContactTagAndDispatch({ db, accountId, contactId, tagId: tag.id });
    }
  } catch (err) {
    console.error('[lifecycle-tags] applyPotentialTag failed:', err);
  }
}

/**
 * Remove every "Potencial" and "Caída" tag (`is_potential_tag` /
 * `is_dropped_tag`) a contact has — called the moment a sale actually
 * registers (migration 045's `is_sale_tag` flow), so a closed contact
 * doesn't linger in an earlier funnel stage. Best-effort.
 */
export async function clearLifecycleTagsOnSale(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  await removeTagsByFlag(db, accountId, contactId, ['is_potential_tag', 'is_dropped_tag']);
}

/**
 * Remove the "Caída" tag (`is_dropped_tag`) the moment a contact who
 * had gone quiet writes in again — the recontact/promo worked, so the
 * tag should clear itself rather than sit there until someone notices
 * and untags it by hand. Called from the inbound webhook. Best-effort.
 */
export async function clearDroppedTagOnReactivation(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  await removeTagsByFlag(db, accountId, contactId, ['is_dropped_tag']);
}

/**
 * Remove the "Potencial" tag from a contact that just got marked
 * "Caída" by the lifecycle cron — it's now dropped, not still
 * mid-funnel. Best-effort.
 */
export async function clearPotentialTagOnDrop(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  await removeTagsByFlag(db, accountId, contactId, ['is_potential_tag']);
}

async function removeTagsByFlag(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  flags: ('is_potential_tag' | 'is_dropped_tag')[],
): Promise<void> {
  try {
    const { data: tags } = await db
      .from('tags')
      .select('id')
      .eq('account_id', accountId)
      .or(flags.map((f) => `${f}.eq.true`).join(','));
    if (!tags || tags.length === 0) return;

    const { data: contactTags } = await db
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', contactId)
      .in(
        'tag_id',
        (tags as { id: string }[]).map((t) => t.id),
      );
    if (!contactTags || contactTags.length === 0) return;

    for (const { tag_id } of contactTags as { tag_id: string }[]) {
      await removeContactTag(db, { accountId, contactId, tagId: tag_id });
    }
  } catch (err) {
    console.error('[lifecycle-tags] removeTagsByFlag failed:', err);
  }
}
