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
