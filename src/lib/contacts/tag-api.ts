interface ContactTagMutationResult {
  added?: boolean;
  dispatched?: boolean;
  reason?: 'duplicate' | 'max_depth';
  /** Present when adding a "sale tag" (migration 045) created a deal. */
  dealId?: string | null;
}

async function mutateContactTag(
  contactId: string,
  tagId: string,
  method: 'POST' | 'DELETE',
  price?: number
): Promise<ContactTagMutationResult> {
  const response = await fetch(`/api/contacts/${contactId}/tags`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      price === undefined ? { tag_id: tagId } : { tag_id: tagId, price }
    ),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & ContactTagMutationResult;
  if (!response.ok) {
    throw new Error(body.error ?? 'Failed to update contact tag');
  }
  return body;
}

/**
 * `price` is only meaningful for a "sale tag" — pass it when the caller
 * already prompted for a price (see src/lib/contacts/sale-tag.ts for
 * what the server does with it). Omit it for a normal tag toggle.
 */
export function addContactTag(contactId: string, tagId: string, price?: number) {
  return mutateContactTag(contactId, tagId, 'POST', price);
}

export function deleteContactTag(contactId: string, tagId: string) {
  return mutateContactTag(contactId, tagId, 'DELETE');
}
