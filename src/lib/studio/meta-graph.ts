/**
 * Meta Graph API helpers for Studio (Facebook Page + Instagram Business
 * publishing) — a separate surface from src/lib/whatsapp/meta-api.ts,
 * which is WhatsApp-Cloud-API-specific. Same lightweight pattern
 * (named-params functions, one shared error helper), different API
 * products: Facebook Login OAuth, Pages, Instagram Graph API.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// OAuth
// ============================================================

export interface ExchangeCodeArgs {
  code: string
  redirectUri: string
  appId: string
  appSecret: string
}

/**
 * Exchange the OAuth `code` from the Facebook Login redirect for a
 * short-lived user access token.
 */
export async function exchangeCodeForUserToken(
  args: ExchangeCodeArgs,
): Promise<{ accessToken: string }> {
  const { code, redirectUri, appId, appSecret } = args
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  })
  const response = await fetch(`${META_API_BASE}/oauth/access_token?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta OAuth code exchange failed: ${response.status}`)
  }
  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Meta did not return an access token.')
  return { accessToken: data.access_token }
}

export interface ExchangeLongLivedArgs {
  shortLivedToken: string
  appId: string
  appSecret: string
}

/**
 * Exchange a short-lived user token for a long-lived one (~60 days).
 * Page tokens minted from this long-lived user token remain valid in
 * practice as long as the user token isn't revoked.
 */
export async function exchangeForLongLivedToken(
  args: ExchangeLongLivedArgs,
): Promise<{ accessToken: string; expiresInSeconds: number | null }> {
  const { shortLivedToken, appId, appSecret } = args
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  })
  const response = await fetch(`${META_API_BASE}/oauth/access_token?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta long-lived token exchange failed: ${response.status}`)
  }
  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!data.access_token) throw new Error('Meta did not return a long-lived access token.')
  return {
    accessToken: data.access_token,
    expiresInSeconds: typeof data.expires_in === 'number' ? data.expires_in : null,
  }
}

/**
 * Resolve the Meta user id behind an access token — stored so a future
 * "reconnect" flow can tell whether the same person re-authorized.
 */
export async function getMetaUser(args: {
  accessToken: string
}): Promise<{ id: string }> {
  const { accessToken } = args
  const params = new URLSearchParams({ access_token: accessToken })
  const response = await fetch(`${META_API_BASE}/me?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta user lookup failed: ${response.status}`)
  }
  const data = (await response.json()) as { id?: string }
  if (!data.id) throw new Error('Meta did not return a user id.')
  return { id: data.id }
}

// ============================================================
// Pages / Instagram
// ============================================================

export interface ManagedPage {
  id: string
  name: string
  accessToken: string
}

/**
 * List the Facebook Pages the connected user manages, with each
 * Page's own access token. Studio only keeps the first — the owner
 * chose a single-Page connection.
 */
export async function listManagedPages(args: {
  userAccessToken: string
}): Promise<ManagedPage[]> {
  const { userAccessToken } = args
  const params = new URLSearchParams({ access_token: userAccessToken })
  const response = await fetch(`${META_API_BASE}/me/accounts?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta Pages lookup failed: ${response.status}`)
  }
  const data = (await response.json()) as {
    data?: { id: string; name: string; access_token: string }[]
  }
  return (data.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
  }))
}

/**
 * Resolve the Instagram Business account linked to a Facebook Page, if
 * any. Returns null when the Page has no linked Instagram account.
 */
export async function getPageInstagramAccount(args: {
  pageId: string
  pageAccessToken: string
}): Promise<{ id: string; username: string } | null> {
  const { pageId, pageAccessToken } = args
  const params = new URLSearchParams({
    fields: 'instagram_business_account{id,username}',
    access_token: pageAccessToken,
  })
  const response = await fetch(`${META_API_BASE}/${pageId}?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta Instagram account lookup failed: ${response.status}`)
  }
  const data = (await response.json()) as {
    instagram_business_account?: { id: string; username: string }
  }
  return data.instagram_business_account ?? null
}

/**
 * The WhatsApp number Meta actually routes Click-to-WhatsApp ad clicks
 * to — this is the Page's own WhatsApp connection (set in Meta
 * Business Suite), which is NOT necessarily the same number this app's
 * WhatsApp Cloud API config sends/receives CRM messages on. Read-only;
 * used to let the owner verify the two match. `null` when the Page has
 * no WhatsApp number connected.
 */
export async function getPageWhatsAppNumber(args: {
  pageId: string
  pageAccessToken: string
}): Promise<string | null> {
  const { pageId, pageAccessToken } = args
  const params = new URLSearchParams({
    fields: 'whatsapp_number',
    access_token: pageAccessToken,
  })
  const response = await fetch(`${META_API_BASE}/${pageId}?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta Page WhatsApp number lookup failed: ${response.status}`)
  }
  const data = (await response.json()) as { whatsapp_number?: string }
  return data.whatsapp_number ?? null
}

/**
 * Subscribe the Page to `messages` webhook events — required once per
 * Page for Meta to start forwarding Messenger/Marketplace buyer
 * messages to our webhook (src/app/api/messenger/webhook). Idempotent:
 * safe to call again on every reconnect.
 */
export async function subscribePageToMessaging(args: {
  pageId: string
  pageAccessToken: string
}): Promise<void> {
  const { pageId, pageAccessToken } = args
  const params = new URLSearchParams({
    subscribed_fields: 'messages',
    access_token: pageAccessToken,
  })
  const response = await fetch(`${META_API_BASE}/${pageId}/subscribed_apps?${params.toString()}`, {
    method: 'POST',
  })
  if (!response.ok) {
    await throwMetaError(response, `Page messaging subscription failed: ${response.status}`)
  }
}

// ============================================================
// Publishing (v1: photo/text only — video/Reels deferred, see
// docs/studio-meta-setup.md and the Studio plan's "out of scope")
// ============================================================

/** Facebook Page feed post with a single photo. */
export async function publishFacebookPhoto(args: {
  pageId: string
  pageAccessToken: string
  imageUrl: string
  caption: string
}): Promise<{ postId: string }> {
  const { pageId, pageAccessToken, imageUrl, caption } = args
  const response = await fetch(`${META_API_BASE}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: imageUrl,
      caption,
      published: true,
      access_token: pageAccessToken,
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Facebook photo publish failed: ${response.status}`)
  }
  const data = (await response.json()) as { post_id?: string; id?: string }
  const postId = data.post_id ?? data.id
  if (!postId) throw new Error('Facebook did not return a post id.')
  return { postId }
}

/** Facebook Page feed text-only post. */
export async function publishFacebookText(args: {
  pageId: string
  pageAccessToken: string
  message: string
}): Promise<{ postId: string }> {
  const { pageId, pageAccessToken, message } = args
  const response = await fetch(`${META_API_BASE}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: pageAccessToken }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Facebook text publish failed: ${response.status}`)
  }
  const data = (await response.json()) as { id?: string }
  if (!data.id) throw new Error('Facebook did not return a post id.')
  return { postId: data.id }
}

/**
 * Instagram feed image post — two-step Graph API flow: create a media
 * container, then publish it. No polling needed for a plain image
 * (unlike video, which needs FINISHED/ERROR status checks — out of
 * scope for v1).
 */
export async function publishInstagramImage(args: {
  igUserId: string
  pageAccessToken: string
  imageUrl: string
  caption: string
}): Promise<{ mediaId: string }> {
  const { igUserId, pageAccessToken, imageUrl, caption } = args

  const createRes = await fetch(`${META_API_BASE}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption,
      access_token: pageAccessToken,
    }),
  })
  if (!createRes.ok) {
    await throwMetaError(createRes, `Instagram media container failed: ${createRes.status}`)
  }
  const createData = (await createRes.json()) as { id?: string }
  if (!createData.id) throw new Error('Instagram did not return a media container id.')

  const publishRes = await fetch(`${META_API_BASE}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: createData.id,
      access_token: pageAccessToken,
    }),
  })
  if (!publishRes.ok) {
    await throwMetaError(publishRes, `Instagram media publish failed: ${publishRes.status}`)
  }
  const publishData = (await publishRes.json()) as { id?: string }
  if (!publishData.id) throw new Error('Instagram did not return a published media id.')
  return { mediaId: publishData.id }
}
