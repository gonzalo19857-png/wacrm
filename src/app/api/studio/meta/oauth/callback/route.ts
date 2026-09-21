import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { verifyOAuthState } from '@/lib/studio/oauth-state'
import {
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  getMetaUser,
  listManagedPages,
  getPageInstagramAccount,
  subscribePageToMessaging,
} from '@/lib/studio/meta-graph'
import { listAdAccounts } from '@/lib/studio/meta-ads'
import { getMetaAppId } from '@/lib/meta-app-id'

/**
 * GET /api/studio/meta/oauth/callback  (admin+)
 *
 * Facebook redirects here after the owner consents. Exchanges the
 * code for a long-lived user token, picks the first managed Page (the
 * owner chose a single-Page connection), resolves its linked Instagram
 * Business account if any, and upserts the single
 * studio_meta_connections row for the account.
 */
export async function GET(request: Request) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  const settingsUrl = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString()
    return siteUrl ? `${siteUrl}/studio/settings?${qs}` : `/studio/settings?${qs}`
  }

  try {
    const ctx = await requireRole('admin')
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const oauthError = url.searchParams.get('error')

    if (oauthError) {
      return NextResponse.redirect(settingsUrl({ meta_error: oauthError }))
    }

    const stateAccountId = verifyOAuthState(state)
    if (!stateAccountId || stateAccountId !== ctx.accountId) {
      return NextResponse.redirect(settingsUrl({ meta_error: 'invalid_state' }))
    }
    if (!code) {
      return NextResponse.redirect(settingsUrl({ meta_error: 'missing_code' }))
    }

    const appId = getMetaAppId()
    const appSecret = process.env.META_APP_SECRET
    if (!appSecret || !siteUrl) {
      return NextResponse.json(
        { error: 'Meta OAuth is not fully configured on the server.' },
        { status: 500 },
      )
    }
    const redirectUri = `${siteUrl}/api/studio/meta/oauth/callback`

    const { accessToken: shortLivedToken } = await exchangeCodeForUserToken({
      code,
      redirectUri,
      appId,
      appSecret,
    })
    const { accessToken: longLivedToken } = await exchangeForLongLivedToken({
      shortLivedToken,
      appId,
      appSecret,
    })

    const [{ id: metaUserId }, pages] = await Promise.all([
      getMetaUser({ accessToken: longLivedToken }),
      listManagedPages({ userAccessToken: longLivedToken }),
    ])

    if (pages.length === 0) {
      return NextResponse.redirect(settingsUrl({ meta_error: 'no_pages' }))
    }
    const page = pages[0]
    const instagram = await getPageInstagramAccount({
      pageId: page.id,
      pageAccessToken: page.accessToken,
    })

    // Ad account is optional — the owner may not have granted
    // ads_management, or may not have an ad account yet. Studio's ad
    // creator just stays unavailable (guarded by ad_account_id being
    // null) rather than failing the whole connection.
    let adAccount: { id: string; name: string; currency: string } | null = null
    try {
      const adAccounts = await listAdAccounts({ userAccessToken: longLivedToken })
      const active = adAccounts.find((a) => a.accountStatus === 1) ?? adAccounts[0] ?? null
      if (active) adAccount = { id: active.id, name: active.name, currency: active.currency }
    } catch (err) {
      console.error('[studio/meta/oauth/callback] ad account lookup failed:', err)
    }

    const { error: upsertError } = await ctx.supabase
      .from('studio_meta_connections')
      .upsert(
        {
          account_id: ctx.accountId,
          meta_user_id: metaUserId,
          long_lived_user_token: encrypt(longLivedToken),
          page_id: page.id,
          page_name: page.name,
          page_access_token: encrypt(page.accessToken),
          instagram_business_account_id: instagram?.id ?? null,
          instagram_username: instagram?.username ?? null,
          ad_account_id: adAccount?.id ?? null,
          ad_account_name: adAccount?.name ?? null,
          ad_account_currency: adAccount?.currency ?? null,
          connected_by: ctx.userId,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' },
      )
    if (upsertError) throw upsertError

    // Best-effort — same pattern as the ad account lookup above. Requires
    // pages_messaging (just added to the scope list); until Meta grants
    // it for this app/Page, this call fails harmlessly and Messenger
    // auto-reply simply won't receive events yet.
    try {
      await subscribePageToMessaging({ pageId: page.id, pageAccessToken: page.accessToken })
    } catch (err) {
      console.error('[studio/meta/oauth/callback] messaging subscription failed:', err)
    }

    return NextResponse.redirect(settingsUrl({ connected: '1' }))
  } catch (err) {
    console.error('[studio/meta/oauth/callback]', err)
    const detail =
      err instanceof Error
        ? err.message
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'unexpected'
    return NextResponse.redirect(settingsUrl({ meta_error: detail.slice(0, 200) }))
  }
}
