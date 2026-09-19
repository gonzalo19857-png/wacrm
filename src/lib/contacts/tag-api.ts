interface ContactTagMutationResult {
  added?: boolean;
  dispatched?: boolean;
  reason?: 'duplicate' | 'max_depth';
  /** Present when adding a "sale tag" (migration 045) created a sale. */
  saleId?: string | null;
}

async function mutateContactTag(
  contactId: string,
  tagId: string,
  method: 'POST' | 'DELETE',
  price?: number,
  fecha?: string,
  region?: 'lima' | 'provincia' | null
): Promise<ContactTagMutationResult> {
  const body: Record<string, unknown> = { tag_id: tagId };
  if (price !== undefined) body.price = price;
  if (fecha !== undefined) body.fecha = fecha;
  if (region) body.region = region;

  const response = await fetch(`/api/contacts/${contactId}/tags`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseBody = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & ContactTagMutationResult;
  if (!response.ok) {
    throw new Error(responseBody.error ?? 'Failed to update contact tag');
  }
  return responseBody;
}

/**
 * `price`/`fecha` are only meaningful for a "sale tag" — pass them
 * when the caller already prompted for them (see
 * src/lib/contacts/sale-tag.ts for what the server does with them).
 * `region` (migration 052, "lima" | "provincia") is the delivery
 * region picked in that same prompt — it links/creates the contact's
 * shipment record. Omit all three for a normal tag toggle.
 */
export function addContactTag(
  contactId: string,
  tagId: string,
  price?: number,
  fecha?: string,
  region?: 'lima' | 'provincia' | null
) {
  return mutateContactTag(contactId, tagId, 'POST', price, fecha, region);
}

export function deleteContactTag(contactId: string, tagId: string) {
  return mutateContactTag(contactId, tagId, 'DELETE');
}
