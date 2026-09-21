import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { clearPotentialTagOnDrop } from '@/lib/contacts/lifecycle-tags'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'

const DEFAULT_DROPPED_AFTER_HOURS = 48
/** Bounds how many contacts one account can push into "Caída" per
 *  run — the cron is meant to run hourly, so a backlog just catches
 *  up over a few runs instead of one invocation doing unbounded work. */
const MAX_CONTACTS_PER_ACCOUNT = 200

/**
 * Tags a contact "Caída" (`tags.is_dropped_tag`, migration 064) once
 * it's gone quiet for the account's configured `dropped_after_hours`
 * without a sale on file — whether or not it ever reached
 * "Potencial" first (`applyPotentialTag`'s [[STAGE:MEDIOS_PAGO]]
 * sentinel only covers leads that got that far; this covers every
 * other stalled chat too, per the account's own request to recover
 * ALL non-buying leads, not just the ones who saw payment info).
 *
 * Meant to be hit on a schedule (VPS crontab — this app has no
 * in-process scheduler, same as /api/automations/cron and
 * /api/studio/publish/cron). Reuses AUTOMATION_CRON_SECRET rather
 * than a dedicated secret so operators only provision one.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()

  // Which accounts opted in, and with which tag(s) — is_dropped_tag is
  // per-tag (not per-account), same opt-in shape as is_sale_tag, so an
  // account can in principle mark more than one tag; every match gets
  // applied.
  const { data: droppedTags, error: tagsError } = await admin
    .from('tags')
    .select('id, account_id')
    .eq('is_dropped_tag', true)
  if (tagsError) {
    return NextResponse.json({ error: tagsError.message }, { status: 500 })
  }
  if (!droppedTags || droppedTags.length === 0) {
    return NextResponse.json({ processedAccounts: 0, taggedContacts: 0 })
  }

  const tagsByAccount = new Map<string, string[]>()
  for (const t of droppedTags as { id: string; account_id: string }[]) {
    const list = tagsByAccount.get(t.account_id) ?? []
    list.push(t.id)
    tagsByAccount.set(t.account_id, list)
  }

  const accountIds = [...tagsByAccount.keys()]
  const { data: configs } = await admin
    .from('ai_configs')
    .select('account_id, dropped_after_hours')
    .in('account_id', accountIds)
  const hoursByAccount = new Map<string, number>(
    (configs ?? []).map((c: { account_id: string; dropped_after_hours: number }) => [
      c.account_id,
      c.dropped_after_hours,
    ]),
  )

  let taggedContacts = 0

  for (const accountId of accountIds) {
    const thresholdHours = hoursByAccount.get(accountId) ?? DEFAULT_DROPPED_AFTER_HOURS
    const { data: leads, error: leadsError } = await admin
      .rpc('find_dropped_leads', {
        p_account_id: accountId,
        p_threshold_hours: thresholdHours,
      })
      .limit(MAX_CONTACTS_PER_ACCOUNT)
    if (leadsError) {
      console.error('[tags lifecycle cron] find_dropped_leads failed:', accountId, leadsError)
      continue
    }
    if (!leads || leads.length === 0) continue

    const tagIds = tagsByAccount.get(accountId) ?? []
    for (const { contact_id } of leads as { contact_id: string }[]) {
      let added = false
      for (const tagId of tagIds) {
        const result = await addContactTagAndDispatch({
          db: admin,
          accountId,
          contactId: contact_id,
          tagId,
        })
        if (result.added) added = true
      }
      if (added) {
        taggedContacts++
        await clearPotentialTagOnDrop(admin, accountId, contact_id)
      }
    }
  }

  return NextResponse.json({ processedAccounts: accountIds.length, taggedContacts })
}
