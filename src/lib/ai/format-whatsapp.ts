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
