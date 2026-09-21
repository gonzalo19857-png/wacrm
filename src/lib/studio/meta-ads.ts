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
// Insights (campaign-level performance, read-only)
// ============================================================

export interface CampaignInsight {
  campaignId: string
  campaignName: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
}

/**
 * Campaign-level performance for the given Meta `date_preset` (default
 * 'last_30d' — pass 'today' for the owner's current-day spend, in the
 * ad account's own timezone). Read-only — doesn't touch studio_ads;
 * callers merge this with the local rows by campaignId if they want
 * name/status from our own DB too (Meta's campaign_name is
 * authoritative on its own).
 */
export async function getCampaignInsights(args: {
  adAccountId: string
  accessToken: string
  datePreset?: string
  /** Custom range (YYYY-MM-DD, inclusive both ends) — overrides datePreset when given. */
  timeRange?: { since: string; until: string }
}): Promise<CampaignInsight[]> {
  const { adAccountId, accessToken, datePreset, timeRange } = args
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc',
    access_token: accessToken,
  })
  if (timeRange) {
    params.set('time_range', JSON.stringify(timeRange))
  } else {
    params.set('date_preset', datePreset ?? 'last_30d')
  }
  const response = await fetch(`${META_API_BASE}/${adAccountId}/insights?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta campaign insights lookup failed: ${response.status}`)
  }
  const data = (await response.json()) as {
    data?: {
      campaign_id: string
      campaign_name: string
      spend?: string
      impressions?: string
      clicks?: string
      ctr?: string
      cpc?: string
    }[]
  }
  return (data.data ?? []).map((row) => ({
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    ctr: Number(row.ctr ?? 0),
    cpc: Number(row.cpc ?? 0),
  }))
}

export interface DailySpend {
  date: string // YYYY-MM-DD
  spend: number
  clicks: number
}

/**
 * Account-wide spend broken down one row per day — for a bookkeeping
 * log ("how much did I pay Meta each day"), not per-campaign detail.
 * Read-only, on-demand (no polling): each call is one Graph API
 * request, same as any other insights lookup here — nothing here
 * spends money or budget, it only reads what already happened.
 */
export async function getDailySpend(args: {
  adAccountId: string
  accessToken: string
  since: string // YYYY-MM-DD
  until: string // YYYY-MM-DD
}): Promise<DailySpend[]> {
  const { adAccountId, accessToken, since, until } = args
  const params = new URLSearchParams({
    level: 'account',
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    fields: 'spend,clicks',
    access_token: accessToken,
  })
  const response = await fetch(`${META_API_BASE}/${adAccountId}/insights?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta daily spend lookup failed: ${response.status}`)
  }
  const data = (await response.json()) as {
    data?: { date_start: string; spend?: string; clicks?: string }[]
  }
  return (data.data ?? []).map((row) => ({
    date: row.date_start,
    spend: Number(row.spend ?? 0),
    clicks: Number(row.clicks ?? 0),
  }))
}

// ============================================================
// Reading an existing campaign (used as a reference/template for
// creating new ones — see /api/studio/ads/reference)
// ============================================================

export interface CampaignSummary {
  id: string
  name: string
  objective: string
  status: string
}

export async function listCampaigns(args: {
  adAccountId: string
  accessToken: string
}): Promise<CampaignSummary[]> {
  const { adAccountId, accessToken } = args
  const params = new URLSearchParams({
    fields: 'id,name,objective,status',
    access_token: accessToken,
  })
  const response = await fetch(`${META_API_BASE}/${adAccountId}/campaigns?${params.toString()}`)
  if (!response.ok) {
    await throwMetaError(response, `Meta campaigns lookup failed: ${response.status}`)
  }
  const data = (await response.json()) as { data?: CampaignSummary[] }
  return data.data ?? []
}

export interface CampaignReference {
  campaign: CampaignSummary
  adSet: {
    id: string
    name: string
    dailyBudget: number | null
    optimizationGoal: string | null
    billingEvent: string | null
    targeting: unknown
  } | null
  creative: {
    message: string | null
    headline: string | null
    linkUrl: string | null
    imageUrl: string | null
    callToActionType: string | null
  } | null
}

/**
 * Pulls targeting + creative for a campaign's first ad set/ad — used
 * to let a new campaign copy what an existing (already-tuned) one is
 * doing rather than starting from a blank targeting/creative guess.
 * Read-only; never touches studio_ads or the campaign itself.
 */
export async function getCampaignReference(args: {
  adAccountId: string
  accessToken: string
  campaignId: string
}): Promise<CampaignReference> {
  const { accessToken, campaignId } = args

  const campaignParams = new URLSearchParams({
    fields: 'id,name,objective,status',
    access_token: accessToken,
  })
  const campaignRes = await fetch(`${META_API_BASE}/${campaignId}?${campaignParams.toString()}`)
  if (!campaignRes.ok) {
    await throwMetaError(campaignRes, `Meta campaign lookup failed: ${campaignRes.status}`)
  }
  const campaign = (await campaignRes.json()) as CampaignSummary

  const adSetParams = new URLSearchParams({
    fields: 'id,name,daily_budget,optimization_goal,billing_event,targeting',
    access_token: accessToken,
  })
  const adSetRes = await fetch(`${META_API_BASE}/${campaignId}/adsets?${adSetParams.toString()}`)
  if (!adSetRes.ok) {
    await throwMetaError(adSetRes, `Meta ad sets lookup failed: ${adSetRes.status}`)
  }
  const adSetData = (await adSetRes.json()) as {
    data?: {
      id: string
      name: string
      daily_budget?: string
      optimization_goal?: string
      billing_event?: string
      targeting?: unknown
    }[]
  }
  const adSetRaw = adSetData.data?.[0] ?? null
  const adSet = adSetRaw
    ? {
        id: adSetRaw.id,
        name: adSetRaw.name,
        dailyBudget: adSetRaw.daily_budget ? Number(adSetRaw.daily_budget) : null,
        optimizationGoal: adSetRaw.optimization_goal ?? null,
        billingEvent: adSetRaw.billing_event ?? null,
        targeting: adSetRaw.targeting ?? null,
      }
    : null

  let creative: CampaignReference['creative'] = null
  if (adSetRaw) {
    const adsParams = new URLSearchParams({
      fields: 'id,creative{id,object_story_spec}',
      access_token: accessToken,
    })
    const adsRes = await fetch(`${META_API_BASE}/${adSetRaw.id}/ads?${adsParams.toString()}`)
    if (adsRes.ok) {
      const adsData = (await adsRes.json()) as {
        data?: {
          creative?: {
            id: string
            object_story_spec?: {
              link_data?: {
                message?: string
                name?: string
                link?: string
                picture?: string
                call_to_action?: { type?: string }
              }
            }
          }
        }[]
      }
      const linkData = adsData.data?.[0]?.creative?.object_story_spec?.link_data
      if (linkData) {
        creative = {
          message: linkData.message ?? null,
          headline: linkData.name ?? null,
          linkUrl: linkData.link ?? null,
          imageUrl: linkData.picture ?? null,
          callToActionType: linkData.call_to_action?.type ?? null,
        }
      }
    }
  }

  return { campaign, adSet, creative }
}

// ============================================================
// Campaign -> Ad Set -> Ad Creative -> Ad
// ============================================================

export async function createCampaign(args: {
  adAccountId: string
  accessToken: string
  name: string
  /** 'OUTCOME_TRAFFIC' (link clicks) unless a Click-to-WhatsApp campaign asks for 'OUTCOME_ENGAGEMENT'. */
  objective?: string
}): Promise<{ id: string }> {
  const { adAccountId, accessToken, name, objective } = args
  return metaPost(`/${adAccountId}/campaigns`, accessToken, {
    name,
    objective: objective ?? 'OUTCOME_TRAFFIC',
    status: 'PAUSED',
    special_ad_categories: [],
    // Every campaign here has exactly one ad set carrying its own
    // daily_budget (no campaign-level budget), so ad sets never share
    // a campaign budget — Meta now requires this explicit either way.
    is_adset_budget_sharing_enabled: false,
  })
}

/**
 * Interest targeting copied from the account owner's own proven
 * Click-to-WhatsApp campaign ("Prueba - Cobertores new") — car/moto
 * interests, read via getCampaignReference. Reused for every
 * Click-to-WhatsApp ad this app creates rather than re-guessing an
 * audience per campaign.
 */
const WHATSAPP_AD_INTERESTS = [
  { id: '6002885312422', name: 'Auto personalizado (vehículo)' },
  { id: '6003176678152', name: 'Automóviles (vehículos)' },
  { id: '6003290047925', name: 'Engine tuning' },
  { id: '6003353550130', name: 'Motocicletas (vehículos)' },
  { id: '6003644639220', name: 'Tuneado de autos (vehículos)' },
]

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
  /** Page the ad set promotes to — required for the 'whatsapp' destination's promoted_object. */
  pageId?: string
  /**
   * Set for a Click-to-WhatsApp ad set: swaps LINK_CLICKS bidding for
   * CONVERSATIONS (WhatsApp chats), matching the account's own proven
   * campaign, and adds the fixed WHATSAPP_AD_INTERESTS audience.
   */
  destinationType?: 'whatsapp'
}): Promise<{ id: string }> {
  const {
    adAccountId,
    accessToken,
    campaignId,
    name,
    dailyBudgetMinorUnits,
    targeting,
    pageId,
    destinationType,
  } = args
  const isWhatsApp = destinationType === 'whatsapp'
  return metaPost(`/${adAccountId}/adsets`, accessToken, {
    name,
    campaign_id: campaignId,
    daily_budget: dailyBudgetMinorUnits,
    billing_event: 'IMPRESSIONS',
    optimization_goal: isWhatsApp ? 'CONVERSATIONS' : 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    status: 'PAUSED',
    ...(isWhatsApp
      ? { destination_type: 'WHATSAPP', promoted_object: { page_id: pageId } }
      : {}),
    targeting: {
      geo_locations: { countries: targeting.countries },
      age_min: targeting.ageMin,
      age_max: targeting.ageMax,
      ...(targeting.genders ? { genders: [targeting.genders] } : {}),
      ...(isWhatsApp ? { flexible_spec: [{ interests: WHATSAPP_AD_INTERESTS }] } : {}),
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
  /** Ignored for destinationType 'whatsapp' — WhatsApp ads have no destination link. */
  linkUrl?: string
  imageUrl: string
  callToActionType: string
  destinationType?: 'whatsapp'
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
    destinationType,
  } = args
  const isWhatsApp = destinationType === 'whatsapp'
  return metaPost(`/${adAccountId}/adcreatives`, accessToken, {
    name,
    object_story_spec: {
      page_id: pageId,
      // Meta rejects this account's stored Page-linked Instagram id on
      // a Click-to-WhatsApp creative ("(#100) Param instagram_actor_id
      // must be a valid Instagram account id") — Instagram placement
      // isn't essential for a WhatsApp CTA ad, so skip it there rather
      // than block the whole ad on an Instagram-specific requirement.
      ...(instagramActorId && !isWhatsApp ? { instagram_actor_id: instagramActorId } : {}),
      link_data: {
        message,
        name: headline,
        picture: imageUrl,
        // link_data requires a `link` regardless of CTA type — for
        // WhatsApp ads this is the same fixed placeholder Meta itself
        // uses (confirmed by inspecting the account's own working
        // Click-to-WhatsApp ad); the CTA's app_destination is what
        // actually routes the click to WhatsApp, not this URL.
        link: isWhatsApp ? 'https://api.whatsapp.com/send' : linkUrl,
        ...(isWhatsApp
          ? { call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } } }
          : { call_to_action: { type: callToActionType, value: { link: linkUrl } } }),
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

export interface CreateAdEndToEndArgs {
  adAccountId: string
  accessToken: string
  pageId: string
  instagramActorId?: string | null
  name: string
  dailyBudgetMinorUnits: number
  targeting: AdSetTargeting
  message: string
  headline: string
  imageUrl: string
  /** 'link' (default): traffic ad to linkUrl/callToActionType. 'whatsapp': Click-to-WhatsApp, no link needed. */
  destinationType?: 'whatsapp'
  linkUrl?: string
  callToActionType?: string
}

/**
 * The full campaign -> ad set -> ad creative -> ad sequence, with
 * best-effort cleanup if a later step fails. Shared by the manual
 * creator (POST /api/studio/ads) and the AI advisor's bulk generator
 * (POST /api/studio/ads/generate) so the rollback behavior only lives
 * in one place.
 */
export async function createAdEndToEnd(
  args: CreateAdEndToEndArgs,
): Promise<{ campaignId: string; adsetId: string; creativeId: string; adId: string }> {
  const {
    adAccountId,
    accessToken,
    pageId,
    instagramActorId,
    name,
    dailyBudgetMinorUnits,
    targeting,
    message,
    headline,
    imageUrl,
    destinationType,
    linkUrl,
    callToActionType,
  } = args

  let campaignId: string | null = null
  try {
    const campaign = await createCampaign({
      adAccountId,
      accessToken,
      name,
      objective: destinationType === 'whatsapp' ? 'OUTCOME_ENGAGEMENT' : 'OUTCOME_TRAFFIC',
    })
    campaignId = campaign.id

    const adSet = await createAdSet({
      adAccountId,
      accessToken,
      campaignId,
      name: `${name} — Ad Set`,
      dailyBudgetMinorUnits,
      targeting,
      pageId,
      destinationType,
    })

    const creative = await createAdCreative({
      adAccountId,
      accessToken,
      pageId,
      instagramActorId,
      name: `${name} — Creative`,
      message,
      headline,
      linkUrl,
      imageUrl,
      callToActionType: callToActionType ?? 'LEARN_MORE',
      destinationType,
    })

    const ad = await createAd({
      adAccountId,
      accessToken,
      adsetId: adSet.id,
      creativeId: creative.id,
      name: `${name} — Ad`,
    })

    return { campaignId, adsetId: adSet.id, creativeId: creative.id, adId: ad.id }
  } catch (err) {
    if (campaignId) {
      await deleteCampaignBestEffort({ adAccountId, accessToken, campaignId })
    }
    throw err
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
