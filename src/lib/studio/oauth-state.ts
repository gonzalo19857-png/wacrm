import crypto from 'node:crypto'

/**
 * Stateless CSRF `state` for the Meta OAuth flow — no extra table or
 * cookie needed. Same HMAC approach as
 * src/lib/whatsapp/webhook-signature.ts, keyed by META_APP_SECRET
 * (already required for the WhatsApp webhook, reused here).
 *
 * Format: "<accountId>.<timestampMs>.<hmacHex>"
 */

const MAX_STATE_AGE_MS = 10 * 60 * 1000 // 10 minutes

function sign(accountId: string, timestamp: string): string {
  const secret = process.env.META_APP_SECRET
  if (!secret) throw new Error('META_APP_SECRET is not set.')
  return crypto.createHmac('sha256', secret).update(`${accountId}.${timestamp}`).digest('hex')
}

export function buildOAuthState(accountId: string): string {
  const timestamp = String(Date.now())
  const signature = sign(accountId, timestamp)
  return `${accountId}.${timestamp}.${signature}`
}

/**
 * Verify a `state` value round-tripped from Facebook's OAuth redirect.
 * Returns the accountId on success, or null if the signature is
 * invalid/missing or the state is older than MAX_STATE_AGE_MS.
 */
export function verifyOAuthState(state: string | null): string | null {
  if (!state) return null
  const parts = state.split('.')
  if (parts.length !== 3) return null
  const [accountId, timestamp, signature] = parts

  let expected: string
  try {
    expected = sign(accountId, timestamp)
  } catch {
    return null
  }

  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  const age = Date.now() - Number(timestamp)
  if (!Number.isFinite(age) || age < 0 || age > MAX_STATE_AGE_MS) return null

  return accountId
}
