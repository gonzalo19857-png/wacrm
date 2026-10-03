import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export type AdProductLine = 'led' | 'cobertor'

/**
 * Same signal GMVA's own campaign names already carry — every LED
 * campaign in the ad account says "LED", "Focos", "Panel", or
 * "Exploradora(s)" (confirmed against the real ad account: "Focos LED
 * general", "PANELES LED 2", "EXPLORADORAS LED", "Panel led"), every
 * cobertor campaign says "Cobertores". Mirrors the keyword list
 * `LED_SIGNAL_REGEX` (src/lib/ai/query.ts) already uses on customer
 * messages, applied here to the campaign NAME instead — classifies a
 * brand-new campaign the moment it's named, no manual mapping to
 * maintain.
 */
const LED_CAMPAIGN_NAME_REGEX = /\bled\b|\bfocos?\b|\bpanel(es)?\b|\bexplorador(a|as|es)?\b/i

function classifyCampaignName(name: string): AdProductLine {
  return LED_CAMPAIGN_NAME_REGEX.test(name) ? 'led' : 'cobertor'
}

/**
 * Resolve which business line (LED vs cobertor) a WhatsApp referral ad
 * click came from, by looking up the ad's campaign name on the Meta
 * Marketing API. Returns null whenever the signal can't be trusted —
 * no Studio Meta connection configured for this account, an
 * undecryptable token, a non-ad referral (organic post click), or a
 * failed/unexpected Graph API response — so the caller falls back to
 * the existing keyword-based detection instead of caching a wrong
 * guess on the contact.
 */
export async function resolveAdCampaignLine(
  db: SupabaseClient,
  accountId: string,
  adId: string,
): Promise<{ campaignId: string; productLine: AdProductLine } | null> {
  try {
    const { data: connection } = await db
      .from('studio_meta_connections')
      .select('long_lived_user_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!connection?.long_lived_user_token) return null

    const accessToken = decrypt(connection.long_lived_user_token)
    const params = new URLSearchParams({
      fields: 'campaign{id,name}',
      access_token: accessToken,
    })
    const response = await fetch(`${META_API_BASE}/${adId}?${params.toString()}`)
    if (!response.ok) return null
    const data = (await response.json()) as {
      campaign?: { id?: string; name?: string }
    }
    if (!data.campaign?.id || !data.campaign?.name) return null
    return {
      campaignId: data.campaign.id,
      productLine: classifyCampaignName(data.campaign.name),
    }
  } catch (err) {
    console.error(`[ad-campaign] failed to resolve campaign line for ad ${adId}:`, err)
    return null
  }
}
