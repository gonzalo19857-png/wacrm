import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/studio/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  publishFacebookPhoto,
  publishFacebookText,
  publishInstagramImage,
} from '@/lib/studio/meta-graph'

/**
 * Drain due `studio_posts` rows (status='approved' AND publish_at in
 * the past) and actually publish them to Facebook/Instagram. Meant to
 * be hit on a schedule (VPS crontab — this app has no in-process
 * scheduler, same as /api/automations/cron and /api/flows/cron).
 * Reuses AUTOMATION_CRON_SECRET rather than a dedicated secret so
 * operators only provision one.
 *
 * The claim step (status='publishing') is the same optimistic lock
 * used by automation_pending_executions — a plain UPDATE-by-id
 * conditioned on the row still being 'approved'.
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
  const { data: due, error } = await admin
    .from('studio_posts')
    .select('*')
    .eq('status', 'approved')
    .lte('publish_at', new Date().toISOString())
    .order('publish_at', { ascending: true })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0, failed: 0 })

  let processed = 0
  let failed = 0

  for (const row of due) {
    const { data: claim } = await admin
      .from('studio_posts')
      .update({ status: 'publishing' })
      .eq('id', row.id)
      .eq('status', 'approved')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    try {
      const { data: connection, error: connError } = await admin
        .from('studio_meta_connections')
        .select('page_id, page_access_token, instagram_business_account_id')
        .eq('account_id', row.account_id)
        .maybeSingle()
      if (connError) throw connError
      if (!connection) throw new Error('No hay conexión con Meta para esta cuenta.')

      const pageAccessToken = decrypt(connection.page_access_token)
      let externalId: string

      if (row.platform === 'facebook') {
        if (row.format === 'photo') {
          if (!row.media_url) throw new Error('Falta la foto.')
          const { postId } = await publishFacebookPhoto({
            pageId: connection.page_id,
            pageAccessToken,
            imageUrl: row.media_url,
            caption: row.caption,
          })
          externalId = postId
        } else {
          const { postId } = await publishFacebookText({
            pageId: connection.page_id,
            pageAccessToken,
            message: row.caption,
          })
          externalId = postId
        }
      } else {
        if (!connection.instagram_business_account_id) {
          throw new Error('No hay una cuenta de Instagram conectada.')
        }
        if (!row.media_url) throw new Error('Falta la foto.')
        const { mediaId } = await publishInstagramImage({
          igUserId: connection.instagram_business_account_id,
          pageAccessToken,
          imageUrl: row.media_url,
          caption: row.caption,
        })
        externalId = mediaId
      }

      await admin
        .from('studio_posts')
        .update({
          status: 'published',
          meta_post_id: externalId,
          published_at: new Date().toISOString(),
          error_detail: null,
        })
        .eq('id', row.id)
      processed++
    } catch (err) {
      console.error('[studio/publish/cron] publish failed for post', row.id, err)
      await admin
        .from('studio_posts')
        .update({
          status: 'failed',
          error_detail: err instanceof Error ? err.message : 'Unknown error',
        })
        .eq('id', row.id)
      failed++
    }
  }

  return NextResponse.json({ processed, failed })
}
