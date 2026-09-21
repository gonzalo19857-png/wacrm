/**
 * Meta Marketing API helpers for Studio's ad creator — a different
 * product from meta-graph.ts (Pages/Instagram organic publishing).
 * Same lightweight pattern and error helper, different API surface:
 * ad accounts, campaigns, ad sets, ad creatives, ads.
 *
 * v1 scope (owner's own choice): single-objective (OUTCOME_TRAFFIC,
 * a link-click ad), single image creative, automatic placements (no
 * placement fields sent = Meta's Advantage+ default). Every create
 * call below passes status: 'PAUSED' — nothing spends until a
 * separate, explicit "activate" call flips status on all three
 * levels. See src/app/api/studio/ads/route.ts and
 * src/app/api/studio/ads/[id]/status/route.ts.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: { message?: string; code?: number; error_user_msg?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.error_user_msg) message = data.error.error_user_msg
    else if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

async function metaPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${META_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: accessToken }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta Marketing API call to ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

// ============================================================
// Ad accounts
// ============================================================

export interface ManagedAdAccount {
  id: string // "act_123456789"
  name: string
  currency: string
  accountStatus: number // 1 = ACTIVE
}

/**
 * List the ad accounts the connected user can advertise from. Studio
 * only keeps the first ACTIVE one — same single-connection assumption
 * as listManagedPages in meta-graph.ts.
 */
export async function listAdAccounts(args: {
  userAccessToken: string
}): Promise<ManagedAdAccount[]> {
  const { userAccessToken } = args
  const params = new URLSearchParams({
    fields: 'id,name,currency,account_status',
    access_token: userAccessToken,
  })
  const response = await fetch(`${META_API_BASE}/me/adaccounts?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta ad accounts lookup failed: ${response.status}`)
  }
  const data = (await response.json()) as {
    data?: { id: string; name: string; currency: string; account_status: number }[]
  }
  return (data.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    accountStatus: a.account_status,
  }))
}

// ============================================================
// Campaign -> Ad Set -> Ad Creative -> Ad
// ============================================================

export async function createCampaign(args: {
  adAccountId: string
  accessToken: string
  name: string
}): Promise<{ id: string }> {
  const { adAccountId, accessToken, name } = args
  return metaPost(`/${adAccountId}/campaigns`, accessToken, {
    name,
    objective: 'OUTCOME_TRAFFIC',
    status: 'PAUSED',
    special_ad_categories: [],
  })
}

export interface AdSetTargeting {
  countries: string[]
  ageMin: number
  ageMax: number
  /** Omit for "all" — Meta defaults to every gender when unset. */
  genders?: 1 | 2
}

export async function createAdSet(args: {
  adAccountId: string
  accessToken: string
  campaignId: string
  name: string
  /** Daily budget in the ad account's minor currency unit (e.g. cents). */
  dailyBudgetMinorUnits: number
  targeting: AdSetTargeting
}): Promise<{ id: string }> {
  const { adAccountId, accessToken, campaignId, name, dailyBudgetMinorUnits, targeting } = args
  return metaPost(`/${adAccountId}/adsets`, accessToken, {
    name,
    campaign_id: campaignId,
    daily_budget: dailyBudgetMinorUnits,
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    status: 'PAUSED',
    targeting: {
      geo_locations: { countries: targeting.countries },
      age_min: targeting.ageMin,
      age_max: targeting.ageMax,
      ...(targeting.genders ? { genders: [targeting.genders] } : {}),
    },
  })
}

export async function createAdCreative(args: {
  adAccountId: string
  accessToken: string
  pageId: string
  instagramActorId?: string | null
  name: string
  message: string
  headline: string
  linkUrl: string
  imageUrl: string
  callToActionType: string
}): Promise<{ id: string }> {
  const {
    adAccountId,
    accessToken,
    pageId,
    instagramActorId,
    name,
    message,
    headline,
    linkUrl,
    imageUrl,
    callToActionType,
  } = args
  return metaPost(`/${adAccountId}/adcreatives`, accessToken, {
    name,
    object_story_spec: {
      page_id: pageId,
      ...(instagramActorId ? { instagram_actor_id: instagramActorId } : {}),
      link_data: {
        message,
        name: headline,
        link: linkUrl,
        picture: imageUrl,
        call_to_action: { type: callToActionType, value: { link: linkUrl } },
      },
    },
  })
}

export async function createAd(args: {
  adAccountId: string
  accessToken: string
  adsetId: string
  creativeId: string
  name: string
}): Promise<{ id: string }> {
  const { adAccountId, accessToken, adsetId, creativeId, name } = args
  return metaPost(`/${adAccountId}/ads`, accessToken, {
    name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: 'PAUSED',
  })
}

/**
 * Best-effort cleanup for a failed multi-step create — deletes a
 * campaign (which cascades to its ad sets/ads on Meta's side) so a
 * partially-created ad doesn't clutter the owner's Ads Manager.
 * Swallows its own errors; callers should surface the ORIGINAL
 * failure, not this one.
 */
export async function deleteCampaignBestEffort(args: {
  adAccountId: string
  accessToken: string
  campaignId: string
}): Promise<void> {
  const { accessToken, campaignId } = args
  try {
    await fetch(`${META_API_BASE}/${campaignId}?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'DELETE',
    })
  } catch {
    // best effort — nothing more to do
  }
}

/**
 * Flips status on campaign + ad set + ad together — spend only
 * actually happens when all three are ACTIVE, and pausing the ad
 * alone is enough to stop it, but keeping all three in lockstep keeps
 * the local `studio_ads.status` mirror unambiguous.
 */
export async function setAdActive(args: {
  accessToken: string
  campaignId: string
  adsetId: string
  adId: string
  active: boolean
}): Promise<void> {
  const { accessToken, campaignId, adsetId, adId, active } = args
  const status = active ? 'ACTIVE' : 'PAUSED'
  for (const id of [campaignId, adsetId, adId]) {
    await metaPost(`/${id}`, accessToken, { status })
  }
}
