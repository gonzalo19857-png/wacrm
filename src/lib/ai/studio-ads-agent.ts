// ============================================================
// Studio's ad-campaign advisor — same molde as studio-calendar-agent.ts:
// a conversational planning persona (grounded in the product catalog,
// real Meta Ads performance, and the account's own proven campaign)
// followed by a JSON-constrained generation step that proposes new
// Click-to-WhatsApp campaigns for the owner to review before they're
// actually created (see /api/studio/ads/chat and /api/studio/ads/generate).
// ============================================================

import type { CatalogProduct } from './marketing-agents'
import type { CampaignInsight, CampaignReference } from '@/lib/studio/meta-ads'

export function buildAdsAdvisorPlannerSystemPrompt(args: {
  businessContext: string | null
  products: CatalogProduct[]
  campaignInsights: CampaignInsight[] | null
  referenceCampaigns: CampaignReference[]
}): string {
  const { businessContext, products, campaignInsights, referenceCampaigns } = args
  const parts: string[] = [
    'You are the in-house Meta Ads advisor for this business, having a planning conversation with the owner about new Click-to-WhatsApp ad campaigns (a native "Send WhatsApp" button ad, not a link-click ad). ' +
      'This is a conversation, not the final deliverable — help them decide, campaign by campaign, what angle/location/product to feature and what daily budget to use. Ask a short clarifying question when something material is missing (which product/zone to feature, budget), but don\'t interrogate — keep it light and move the planning forward. ' +
      'Reply in the same language the owner writes in, keep replies conversational and short, never output JSON here.',
    'Every campaign runs targeted at the whole country (no real geo-radius targeting is available here) and reuses the same proven audience (car/vehicle-owner interests) as the account\'s existing working campaign. Any "location" or "zone" the owner gives you becomes the campaign\'s name and the angle of its ad copy (e.g. mentioning that zone), not an actual geographic radius — say so plainly if they seem to expect real geo-fencing.',
    'When the owner seems ready (they\'ve told you how many campaigns, roughly what to feature in each, and a budget), tell them they can click "Crear campañas" whenever they want — you do not create anything yourself in this chat, a separate step does that using this conversation as the brief. Every campaign it creates lands PAUSED in Meta — nothing spends until the owner activates it.',
    'Never invent sales/performance data not given to you below. If the owner mentions a zone or fact from their own memory/experience (e.g. "La Victoria sells more"), treat it as their input, not something you verified.',
  ]

  if (referenceCampaigns.length > 0) {
    const list = referenceCampaigns
      .map((ref) => {
        const targetingNote = ref.adSet?.targeting ? JSON.stringify(ref.adSet.targeting) : 'no disponible'
        const creativeNote = ref.creative
          ? `headline "${ref.creative.headline ?? ''}", texto: ${ref.creative.message ?? '(no disponible)'}`
          : 'no disponible (probablemente un anuncio de video, el detalle de creatividad no se pudo leer)'
        return (
          `- ${ref.campaign.name} (status: ${ref.campaign.status}, objetivo: ${ref.campaign.objective}, optimización: ${ref.adSet?.optimizationGoal ?? 'n/a'})\n` +
          `  Targeting: ${targetingNote}\n` +
          `  Creativo: ${creativeNote}`
        )
      })
      .join('\n')
    parts.push(
      `The account's own real, currently-ACTIVE campaigns (use these as proven reference for targeting/tone — the owner can ask about any of them specifically):\n${list}`,
    )
  }

  if (campaignInsights && campaignInsights.length > 0) {
    const list = campaignInsights
      .map(
        (c) =>
          `- ${c.campaignName}: gasto ${c.spend.toFixed(2)}, ${c.clicks} clics, CTR ${c.ctr.toFixed(2)}%, CPC ${c.cpc.toFixed(2)} (últimos 30 días)`,
      )
      .join('\n')
    parts.push(`Real performance of the account's Meta Ads campaigns, last 30 days:\n${list}`)
  } else {
    parts.push('No hay datos de rendimiento de Meta Ads disponibles todavía (cuenta sin campañas con actividad reciente, o sin conexión).')
  }

  if (businessContext && businessContext.trim()) {
    parts.push(`Business context (voice, tone, policies):\n${businessContext.trim()}`)
  }

  if (products.length > 0) {
    const list = products
      .map((p) => `- ${p.name}: ${p.currency} ${p.price.toFixed(2)}${p.description ? ` — ${p.description}` : ''}`)
      .join('\n')
    parts.push(`Product catalog:\n${list}`)
  }

  return parts.join('\n\n')
}

export interface GeneratedAdCampaign {
  name: string
  dailyBudget: number
  headline: string
  message: string
  locationLabel: string | null
}

export function buildAdsGeneratorSystemPrompt(args: {
  businessContext: string | null
  products: CatalogProduct[]
  notes: string | null
}): string {
  const { businessContext, products, notes } = args
  const parts: string[] = [
    'You are the in-house Meta Ads advisor for this business, about to propose a set of new Click-to-WhatsApp campaigns based on a planning conversation with the owner (the brief below). ' +
      'Propose at most 10 campaigns — exactly as many as the brief calls for, or a sensible small number (3-5) if the brief doesn\'t specify.',
    'Respond with ONLY a JSON array, no prose before or after, no markdown code fence. Each element:\n' +
      '{"name": string, "daily_budget": number, "headline": string, "message": string, "location_label": string|null}\n' +
      '- "name" is the internal campaign name — short, includes the product/angle and location_label if any (e.g. "Cobertores — La Victoria").\n' +
      '- "daily_budget" is a plain number in Peruvian soles (PEN) per day, taken from the brief (never invent a number the owner didn\'t give).\n' +
      '- "headline" is a short ad headline (a few words).\n' +
      '- "message" is the actual ad body text: concrete product benefits from the catalog below, a sense of urgency/offer only if it follows from the brief, and a closing line inviting the reader to write in on WhatsApp. Same language as the brief. No emoji spam — a few where natural is fine.\n' +
      '- "location_label" is the zone/angle from the brief for that campaign, or null if the brief didn\'t differentiate by zone.',
    'Never invent facts, prices, stock, or promotions not present in the business context, product catalog, or brief below — write generically instead.',
  ]

  if (notes && notes.trim()) {
    parts.push(`Planning conversation with the owner (the brief):\n${notes.trim()}`)
  }

  if (businessContext && businessContext.trim()) {
    parts.push(`Business context (voice, tone, policies):\n${businessContext.trim()}`)
  }

  if (products.length > 0) {
    const list = products
      .map((p) => `- ${p.name}: ${p.currency} ${p.price.toFixed(2)}${p.description ? ` — ${p.description}` : ''}`)
      .join('\n')
    parts.push(`Product catalog (only real products you may reference):\n${list}`)
  } else {
    parts.push('The product catalog is currently empty — write generic ad copy rather than product-specific claims.')
  }

  return parts.join('\n\n')
}

const MAX_CAMPAIGNS = 10

/**
 * Parse + hand-validate the model's JSON array response — same
 * hand-rolled style as parseCalendarGeneration in studio-calendar-agent.ts
 * (no schema library in this repo).
 */
export function parseAdsGeneration(raw: string): GeneratedAdCampaign[] {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let data: unknown
  try {
    data = JSON.parse(stripped)
  } catch {
    throw new Error('La IA no devolvió JSON válido.')
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('La IA no devolvió ninguna campaña.')
  }
  if (data.length > MAX_CAMPAIGNS) {
    throw new Error(`La IA propuso demasiadas campañas (${data.length}, máx. ${MAX_CAMPAIGNS}).`)
  }

  return data.map((row, i) => {
    const label = `campaña ${i + 1}`
    if (!row || typeof row !== 'object') {
      throw new Error(`La IA devolvió datos inválidos (${label}).`)
    }
    const r = row as Record<string, unknown>

    if (typeof r.name !== 'string' || !r.name.trim()) {
      throw new Error(`Falta "name" en ${label}.`)
    }
    const dailyBudget = typeof r.daily_budget === 'number' ? r.daily_budget : NaN
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
      throw new Error(`"daily_budget" inválido en ${label}.`)
    }
    if (typeof r.headline !== 'string' || !r.headline.trim()) {
      throw new Error(`Falta "headline" en ${label}.`)
    }
    if (typeof r.message !== 'string' || !r.message.trim()) {
      throw new Error(`Falta "message" en ${label}.`)
    }
    const locationLabel =
      typeof r.location_label === 'string' && r.location_label.trim() ? r.location_label.trim() : null

    return {
      name: r.name.trim(),
      dailyBudget,
      headline: r.headline.trim(),
      message: r.message.trim(),
      locationLabel,
    }
  })
}
