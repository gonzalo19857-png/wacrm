/**
 * Facebook Messenger identifies senders by PSID (Page-Scoped ID, a
 * numeric string) rather than a phone number. `contacts.phone` is
 * NOT NULL and drives dedup (phone_normalized generated column +
 * unique index, migration 022), so rather than touch that core table
 * we store the PSID straight into `phone`, prefixed so it's never
 * mistaken for a real number — the same trick this codebase already
 * uses for WhatsApp's BSUID fallback (see `isBsuid` in
 * `src/lib/whatsapp/phone-utils.ts`).
 *
 * No dedup collision risk: `phone_normalized` strips everything but
 * digits, and a PSID is always far longer than a real phone number's
 * digit count, so the two can never produce the same normalized value.
 */

const PSID_PREFIX = 'psid:'

/** Build the `contacts.phone` value for a Messenger PSID. */
export function toContactPhone(psid: string): string {
  return `${PSID_PREFIX}${psid}`
}

/** True when a stored `contacts.phone` value is actually a Messenger PSID. */
export function isMessengerContactPhone(phone: string): boolean {
  return typeof phone === 'string' && phone.startsWith(PSID_PREFIX) && phone.length > PSID_PREFIX.length
}

/** Extract the raw PSID back out of a `contacts.phone` value, or null. */
export function psidFromContactPhone(phone: string): string | null {
  return isMessengerContactPhone(phone) ? phone.slice(PSID_PREFIX.length) : null
}
