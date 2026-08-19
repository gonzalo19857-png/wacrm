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
export function retrievalQueryCandidates(messages: ChatMessage[]): string[] {
  const latest = latestUserMessage(messages, 1)
  if (alreadyRecommendedTalla(messages)) return [latest]
  const widened = latestUserMessage(messages, DEFAULT_WINDOW)
  return latest === widened ? [latest] : [latest, widened]
}
