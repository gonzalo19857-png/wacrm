import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buildOAuthState } from '@/lib/studio/oauth-state'
import { getMetaAppId } from '@/lib/meta-app-id'

/**
 * GET /api/studio/meta/oauth/start  (admin+)
 *
 * Redirects the browser into Facebook's OAuth consent dialog. The
 * redirect_uri sent here must exactly match what's registered in the
 * Meta App's Facebook Login settings — see docs/studio-meta-setup.md.
 */
export async function GET() {
  try {
    const { accountId } = await requireRole('admin')

    const appId = getMetaAppId()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
    if (!siteUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SITE_URL is not configured on the server.' },
        { status: 500 },
      )
    }

    const redirectUri = `${siteUrl}/api/studio/meta/oauth/callback`
    const state = buildOAuthState(accountId)
    const scope = [
      'pages_show_list',
      'pages_manage_posts',
      'pages_manage_metadata',
      'pages_read_engagement',
      'pages_messaging',
      'instagram_basic',
      'instagram_content_publish',
      'business_management',
      'ads_management',
      'ads_read',
    ].join(',')

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      scope,
      response_type: 'code',
    })

    return NextResponse.redirect(
      `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`,
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
