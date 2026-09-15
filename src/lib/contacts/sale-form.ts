/**
 * Push a newly-registered sale to an external Google Form (migration
 * 048) so it lands as a row in whatever Sheet the form is linked to.
 *
 * No Google API credentials involved: Google Forms accepts a plain
 * `application/x-www-form-urlencoded` POST to the form's own
 * `.../formResponse` endpoint with `entry.<id>=<value>` fields — the
 * same request the browser makes when a human submits the form. The
 * account admin only ever has to paste the form's normal share link
 * (`.../viewform`); `toFormResponseUrl` rewrites it.
 */

export interface SaleFormIntegration {
  formResponseUrl: string
  fieldClientEntry: string | null
  fieldProductEntry: string | null
  fieldPriceEntry: string | null
  fieldPhoneEntry: string | null
}

/** `.../viewform?...` → `.../formResponse`. Passed through unchanged
 *  if it's already a formResponse URL or doesn't match the expected
 *  shape (the POST below will then just fail — surfaced as a log, not
 *  a thrown error, since this always runs best-effort). */
export function toFormResponseUrl(url: string): string {
  return url.trim().replace(/\/viewform(?:\?.*)?$/, '/formResponse')
}

/**
 * Fire-and-check POST — swallows all errors (network, non-2xx, a
 * malformed URL) so a broken or unreachable form integration can never
 * fail the sale-tag request that already saved the sale. Logs on
 * failure so it's diagnosable from server logs rather than silently
 * vanishing.
 */
export async function pushSaleToGoogleForm(
  integration: SaleFormIntegration,
  sale: {
    title: string
    value: number
    currency: string
    clientName: string
    clientPhone: string
  },
): Promise<void> {
  const { fieldClientEntry, fieldProductEntry, fieldPriceEntry, fieldPhoneEntry } = integration
  const url = toFormResponseUrl(integration.formResponseUrl)

  const body = new URLSearchParams()
  if (fieldClientEntry) body.set(fieldClientEntry, sale.clientName)
  if (fieldProductEntry) body.set(fieldProductEntry, sale.title)
  if (fieldPriceEntry) body.set(fieldPriceEntry, `${sale.currency} ${sale.value}`)
  if (fieldPhoneEntry) body.set(fieldPhoneEntry, sale.clientPhone)

  if ([...body.keys()].length === 0) {
    console.error('[sale-form] no field mapping configured — nothing to send')
    return
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    // Google Forms replies 200 with an HTML confirmation page even on
    // most validation failures, so a non-2xx here almost always means
    // the URL itself is wrong (form deleted/unpublished) — that's the
    // failure mode worth a log line.
    if (!res.ok) {
      console.error(`[sale-form] form POST returned ${res.status} for ${url}`)
    }
  } catch (err) {
    console.error('[sale-form] form POST threw:', err)
  }
}
