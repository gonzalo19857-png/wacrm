// ============================================================
// Studio's content-calendar generator — a sibling of marketing-agents.ts,
// same product-grounding approach, but instead of a chat persona it
// proposes a whole month's grid in one shot as structured JSON, which
// the Studio UI renders as an editable table for the owner to approve.
// ============================================================

import type { CatalogProduct } from './marketing-agents'

export type StudioPostPlatform = 'facebook' | 'instagram'
export type StudioPostFormat = 'photo' | 'text'

export interface GeneratedCalendarPost {
  date: string // YYYY-MM-DD
  platform: StudioPostPlatform
  format: StudioPostFormat
  idea: string
  caption: string
  hashtags: string[]
  productName: string | null
}

export function buildCalendarGeneratorSystemPrompt(args: {
  businessContext: string | null
  products: CatalogProduct[]
  month: string // YYYY-MM-01
  notes: string | null
}): string {
  const { businessContext, products, month, notes } = args
  const parts: string[] = [
    'You are the in-house social media planner for this business, proposing next month\'s content calendar for Facebook and Instagram. ' +
      'You are chatting with the business owner, who will review and edit every post before anything publishes — propose a solid draft, not a final answer.',
    `Plan for the month starting ${month}. Propose 10-16 posts spread across the month (not every single day), a realistic mix of platforms.`,
    'Respond with ONLY a JSON array, no prose before or after, no markdown code fence. Each element:\n' +
      '{"date": "YYYY-MM-DD", "platform": "facebook"|"instagram", "format": "photo"|"text", "idea": string, "caption": string, "hashtags": string[], "product_name": string|null}\n' +
      '- "format":"text" is only valid when "platform":"facebook" — Instagram has no text-only feed post, every Instagram entry must be "photo".\n' +
      '- "idea" is a short internal label (e.g. "Antes/después de instalación de amortiguadores"), NOT shown to customers.\n' +
      '- "caption" is the actual ready-to-post text, in the same language as the business context below.\n' +
      '- "hashtags" is a plain array of tags WITHOUT the # symbol, 3-8 per post, empty array if none fit.\n' +
      '- "product_name" is the exact name of one product from the catalog below when the post is about a specific product, or null for general/brand posts. Never invent a product not in the catalog.\n' +
      '- Every date must fall within the given month.',
    'Never invent facts, prices, promotions, or availability not present in the business context or product catalog below — write generically instead (e.g. "consulta el precio" rather than a made-up number).',
  ]

  if (notes && notes.trim()) {
    parts.push(`Brief from the owner for this month:\n${notes.trim()}`)
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
    parts.push('The product catalog is currently empty — propose general/brand content rather than product-specific posts.')
  }

  return parts.join('\n\n')
}

/**
 * System prompt for the conversational planning step — a normal chat
 * persona (not JSON-constrained) the owner talks to BEFORE anything is
 * generated, to define cadence, key dates/promos, focus products, and
 * tone. The transcript from this chat later becomes the "brief" fed to
 * `buildCalendarGeneratorSystemPrompt` when the owner clicks Generate —
 * see `serializeConversationAsNotes`.
 */
export function buildCalendarPlannerSystemPrompt(args: {
  businessContext: string | null
  products: CatalogProduct[]
  month: string // YYYY-MM-01
}): string {
  const { businessContext, products, month } = args
  const parts: string[] = [
    'You are the in-house social media planner for this business, having a planning conversation with the owner about next month\'s content calendar for Facebook and Instagram (starting ' +
      `${month}). This is a conversation, not the final deliverable — help them think through cadence (how many posts/week), key dates or promotions to build around, which products to feature, and tone. ` +
      'Ask a short clarifying question when something material is missing (e.g. no mention of any promotion or focus), but don\'t interrogate — keep it light and move the planning forward. ' +
      'Reply in the same language the owner writes in, keep replies conversational and short (a few sentences), never output JSON here.',
    'When the owner seems ready, tell them they can click "Generar calendario" whenever they want — you do not generate the calendar yourself in this chat, a separate step does that using this conversation as context.',
    'Never invent facts, prices, promotions, or availability not present in the business context or product catalog below.',
  ]

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

/**
 * Flattens a planning chat transcript into the plain-text "brief" that
 * `buildCalendarGeneratorSystemPrompt`'s `notes` param expects.
 */
export function serializeConversationAsNotes(
  messages: { role: 'user' | 'assistant'; content: string }[],
): string | null {
  if (messages.length === 0) return null
  return messages
    .map((m) => `${m.role === 'user' ? 'Dueño' : 'Planificador'}: ${m.content}`)
    .join('\n')
}

const VALID_PLATFORMS: StudioPostPlatform[] = ['facebook', 'instagram']
const VALID_FORMATS: StudioPostFormat[] = ['photo', 'text']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse + hand-validate the model's JSON array response. Throws with
 * the first bad row identified so the route can surface a clear retry
 * message instead of a raw 500 — no schema library in this repo, this
 * follows the same house style as other AI response parsing.
 */
export function parseCalendarGeneration(raw: string): GeneratedCalendarPost[] {
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
    throw new Error('La IA no devolvió ninguna publicación.')
  }

  return data.map((row, i) => {
    const label = `fila ${i + 1}`
    if (!row || typeof row !== 'object') {
      throw new Error(`La IA devolvió datos inválidos (${label}).`)
    }
    const r = row as Record<string, unknown>

    if (typeof r.date !== 'string' || !DATE_RE.test(r.date)) {
      throw new Error(`Fecha inválida en ${label}: ${JSON.stringify(r.date)}.`)
    }
    if (typeof r.platform !== 'string' || !VALID_PLATFORMS.includes(r.platform as StudioPostPlatform)) {
      throw new Error(`Plataforma inválida en ${label}: ${JSON.stringify(r.platform)}.`)
    }
    if (typeof r.format !== 'string' || !VALID_FORMATS.includes(r.format as StudioPostFormat)) {
      throw new Error(`Formato inválido en ${label}: ${JSON.stringify(r.format)}.`)
    }
    if (r.platform === 'instagram' && r.format !== 'photo') {
      throw new Error(`Instagram requiere formato "photo" en ${label}.`)
    }
    if (typeof r.idea !== 'string' || !r.idea.trim()) {
      throw new Error(`Falta "idea" en ${label}.`)
    }
    if (typeof r.caption !== 'string' || !r.caption.trim()) {
      throw new Error(`Falta "caption" en ${label}.`)
    }
    const hashtags = Array.isArray(r.hashtags)
      ? r.hashtags.filter((h): h is string => typeof h === 'string')
      : []
    const productName =
      typeof r.product_name === 'string' && r.product_name.trim() ? r.product_name.trim() : null

    return {
      date: r.date,
      platform: r.platform as StudioPostPlatform,
      format: r.format as StudioPostFormat,
      idea: r.idea.trim(),
      caption: r.caption.trim(),
      hashtags,
      productName,
    }
  })
}
