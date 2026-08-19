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
 * finally getting to the actual follow-up content. Since the features
 * block is specified to be copied verbatim every time, its presence in
 * both an earlier assistant turn and the new reply is an unambiguous
 * signal of this exact failure — safe to strip mechanically rather than
 * hope the model complies.
 */
export function stripRepeatedRecommendation(
  text: string,
  priorAssistantMessages: string[],
): string {
  if (!text.includes(FEATURES_HEADER)) return text
  const alreadyGiven = priorAssistantMessages.some((m) =>
    m.includes(FEATURES_HEADER),
  )
  if (!alreadyGiven) return text

  const headerIdx = text.indexOf(FEATURES_HEADER)
  const afterHeader = text.slice(headerIdx + FEATURES_HEADER.length)
  const blankLine = afterHeader.match(/\n\s*\n/)
  if (!blankLine || blankLine.index === undefined) return text

  const remainder = afterHeader
    .slice(blankLine.index + blankLine[0].length)
    .trim()
  return remainder.length > 0 ? remainder : text
}
