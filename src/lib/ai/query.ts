import type { ChatMessage } from './types'

/** How many trailing customer turns to fold into the retrieval query. */
const DEFAULT_WINDOW = 3

/**
 * The text to retrieve knowledge against: the last few customer
 * (`user`) turns in the conversation context, joined oldest-first.
 * Falls back to the last message of any role, then empty string. Shared
 * by the draft route and the auto-reply bot so both query the knowledge
 * base the same way.
 *
 * A single-message window is too narrow for a lot of real exchanges: a
 * customer names their vehicle ("Kia Seltos"), the bot answers, then
 * they ask a short follow-up ("alguna imagen?") that shares no words
 * with any knowledge chunk on its own. Folding in the last few turns
 * keeps that earlier context in the query so retrieval — and anything
 * keyed off its top match, like the auto-reply's image attachment —
 * still finds the right grounding.
 */
export function latestUserMessage(
  messages: ChatMessage[],
  window = DEFAULT_WINDOW,
): string {
  const userTurns = messages.filter((m) => m.role === 'user').slice(-window)
  if (userTurns.length > 0) return userTurns.map((m) => m.content).join('\n')
  return messages.length > 0 ? messages[messages.length - 1].content : ''
}

/**
 * True once the assistant has already recommended a talla in this
 * conversation. Used to gate the widened-window fallback below: past
 * that point, delivery/logistics follow-ups ("Lima", "Provincia", a
 * bare city name) are answered from fixed prompt text, never the
 * knowledge base, so there is nothing for the widened query to usefully
 * find — it only risks re-matching the earlier vehicle's size-table
 * chunk and getting it re-injected into the prompt, which the model
 * doesn't reliably ignore even when told to (observed live: a bare
 * "Lima" reply re-triggered the full talla/price/features block and
 * re-sent the product photo, despite an explicit prompt instruction not
 * to repeat that information).
 */
function alreadyRecommendedTalla(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) => m.role === 'assistant' && /\btalla\b/i.test(m.content),
  )
}

/**
 * Retrieval query candidates, most-specific first: the single latest
 * customer turn, then (only if that differs) the last few turns joined.
 *
 * Querying with the latest turn ALONE first matters as much as having
 * the wider window available: once a customer names a vehicle, that
 * vehicle's words dominate the joined query for the next turn or two,
 * so if they then name a DIFFERENT vehicle, the join can out-rank it
 * with the stale one and retrieval keeps grounding the reply — and the
 * image it attaches — in the wrong product. Trying the latest turn on
 * its own avoids that; the join is only a fallback for a turn with no
 * keywords of its own (e.g. "alguna imagen?").
 *
 * That fallback is only offered before a talla has been given — see
 * `alreadyRecommendedTalla`. After that point widening does more harm
 * than good, so the single latest turn is the only candidate: if it
 * doesn't mention the product on its own, retrieval should come back
 * empty rather than reach back for the vehicle that's already been
 * handled.
 */
const LED_SIGNAL_REGEX = /\bled\b|\bfoco(s)?\b|\bfaro(s)?\b|\bbarra(s)?\b|\bexplorador(es)?\b|\bproyector(es)?\b|\btechla\b|\biron\b/i

/**
 * True once ANY message in the conversation (customer or bot) already
 * mentioned LED lighting, not just the latest turn: a follow-up like a
 * bare "kia seltos" or "de cuántos w es?" carries no LED keyword of its
 * own, but the conversation still needs to stay anchored to the LED
 * product line once that's the established topic — otherwise it falls
 * through to the vehicle-name query and gets swamped by the cobertor
 * tallas docs (observed live: a fabricated price and generic marketing
 * bullets instead of a real TECHLA/IRON product).
 *
 * Doubles as the product-line switch for which business prompt to send
 * the model — see `selectBusinessPrompt` in `./defaults`. A single
 * `system_prompt` that concatenated both cobertor and LED rules was
 * tried and failed a live regression test (LED's "only Plin, don't ask
 * payment method" rule bled into cobertor replies); keeping the two
 * prompts separate and picking exactly one per reply, based on this
 * same signal, is what actually keeps them from mixing.
 *
 * `adProductLine` is the precise signal from `resolveAdCampaignLine`
 * (src/lib/meta/ad-campaign.ts): the Meta ad campaign that actually
 * brought this contact in, resolved once at the first inbound message
 * and cached on `contacts.ad_product_line`. When it says 'led', that
 * wins outright — a customer who clicked a LED ad and just says
 * "cuánto cuesta" carries no LED keyword of its own, so the campaign is
 * the only way to get that turn right. It's deliberately only checked
 * for a positive 'led' match, never used to force a 'false': a contact
 * attributed to a cobertor campaign who later asks about LED anyway
 * should still be caught by the keyword fallback below, not silently
 * misrouted because of the ad they happened to click.
 */
export function isLedConversation(
  messages: ChatMessage[],
  adProductLine?: 'led' | 'cobertor' | null,
): boolean {
  if (adProductLine === 'led') return true
  return messages.some((m) => LED_SIGNAL_REGEX.test(m.content))
}

export function retrievalQueryCandidates(
  messages: ChatMessage[],
  adProductLine?: 'led' | 'cobertor' | null,
): string[] {
  const latest = latestUserMessage(messages, 1)
  if (isLedConversation(messages, adProductLine)) return ['LED']
  if (alreadyRecommendedTalla(messages)) return [latest]
  const widened = latestUserMessage(messages, DEFAULT_WINDOW)
  return latest === widened ? [latest] : [latest, widened]
}
