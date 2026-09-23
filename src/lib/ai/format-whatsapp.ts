/**
 * Deterministic touch-up for the auto-reply's WhatsApp formatting.
 *
 * Prompting alone can't guarantee this: even a strong worked example
 * gets the bold markers and spacing right only some of the time (small
 * models are inconsistent about literal formatting instructions run
 * after run). Rather than keep tuning the prompt and hoping it sticks,
 * this enforces the two things that actually matter — the talla and
 * price wrapped in WhatsApp's `*bold*`, and a blank line separating the
 * price from what follows — on whatever text the model produced.
 *
 * Both regexes are idempotent (re-running on already-correct text is a
 * no-op), so it's safe to apply regardless of whether the model
 * happened to get it right on its own.
 */
export function enforceWhatsAppEmphasis(text: string): string {
  let out = text

  // "talla M" / "*talla M*" -> "*talla M*" (also L, XL, XXL, XXXL).
  // Deliberately an allowlist of the real size codes rather than "any
  // word after talla": the model occasionally writes something odd
  // like "talla SUV-L" (conflating the category into the size), and a
  // loose \w+ capture would only wrap "SUV" — leaving the model's own
  // asterisk and the "-L" dangling as literal, visibly broken text.
  // Matching nothing (leaving the model's original wording alone) is
  // the safe failure mode; a partial, corrupted wrap is not.
  out = out.replace(
    /\*?\btalla\s+(XXXL|XXL|XL|M|L)\b\*?/gi,
    (_match, code: string) => `*talla ${code}*`,
  )

  // "S/124.90" / "*S/124.90*" -> "*S/124.90*"
  out = out.replace(
    /\*?(S\/\s?[\d][\d.,]*)\*?/g,
    (_match, price: string) => `*${price}*`,
  )

  // Blank line after a "Precio: ..." line, unless already there.
  out = out.replace(/(^Precio:.*$)\n(?!\n)/m, '$1\n\n')

  return out
}

const FEATURES_HEADER = '¿Por qué elegir nuestro cobertor?'

/** First "S/<amount>" found in `s`, whitespace-normalized, or null. */
function extractPrice(s: string): string | null {
  const m = s.match(/S\/\s?[\d][\d.,]*/)
  return m ? m[0].replace(/\s+/g, '') : null
}

/**
 * Strips a re-stated talla/price/features recommendation block from a
 * follow-up reply, keeping only whatever new content follows it.
 *
 * The prompt tells the model, in several places, to give this block
 * only once per vehicle and answer follow-ups (location, questions)
 * with just the new information — but that instruction doesn't reliably
 * hold: observed live, a bare "Lima" reply after the talla had already
 * been given got a reply that opened with the *entire* recommendation
 * again (re-typed from the model's own earlier turn, not sourced from
 * retrieved knowledge — so narrowing retrieval doesn't fix it) before
 * finally getting to the actual follow-up content.
 *
 * The features header text is fixed and vehicle-agnostic, so its mere
 * presence in an earlier turn is NOT enough to call this a repeat — a
 * customer who corrects the vehicle mid-conversation (e.g. "mototaxi
 * Torito" after the bot quoted it as a moto lineal) legitimately gets a
 * new recommendation with the same header but a different price, and
 * that correction must reach them, not get silently discarded (this
 * was observed live: a corrected mototaxi price got stripped down to
 * just the trailing follow-up question). The price quoted right before
 * the header is what actually identifies a genuine repeat — only strip
 * when it matches a price already quoted in an earlier turn's block.
 */
export function stripRepeatedRecommendation(
  text: string,
  priorAssistantMessages: string[],
): string {
  if (!text.includes(FEATURES_HEADER)) return text

  const headerIdx = text.indexOf(FEATURES_HEADER)
  const currentPrice = extractPrice(text.slice(0, headerIdx))

  const alreadyGiven = priorAssistantMessages.some((m) => {
    const priorHeaderIdx = m.indexOf(FEATURES_HEADER)
    if (priorHeaderIdx === -1) return false
    return (
      currentPrice !== null &&
      currentPrice === extractPrice(m.slice(0, priorHeaderIdx))
    )
  })
  if (!alreadyGiven) return text

  const afterHeader = text.slice(headerIdx + FEATURES_HEADER.length)
  const blankLine = afterHeader.match(/\n\s*\n/)
  if (!blankLine || blankLine.index === undefined) return text

  const remainder = afterHeader
    .slice(blankLine.index + blankLine[0].length)
    .trim()
  return remainder.length > 0 ? remainder : text
}

/**
 * Catches a literal, unfilled "[nombre]" template placeholder that
 * survived into the reply — observed live on the Lima closing message
 * ("Quedó registrado: a nombre de [nombre], turno..."), sent when the
 * customer picked a delivery slot but the model never actually asked
 * for (or registered) their name first. The prompt tells the model to
 * check for this before sending, but — like the repeated-recommendation
 * and bold-formatting cases above — that instruction doesn't reliably
 * hold on its own. Rather than let raw template syntax (or a "confirmed"
 * order with no name on it) reach the customer, swap the whole reply for
 * the same short re-ask the prompt itself specifies for a missing name.
 */
export function guardAgainstUnfilledName(text: string): string {
  if (!text.includes('[nombre]')) return text
  return '¡Genial! 😊 Y para dejar todo listo, ¿a nombre de quién sería el pedido? 🙏'
}
