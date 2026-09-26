/**
 * Meta Conversions API — server-to-server event reporting for the
 * WhatsApp sales funnel.
 *
 * Deliberately separate from `src/lib/whatsapp/` — this talks to a
 * different Meta product (Ads/Events Manager, via a Dataset id) than
 * the Cloud API, uses its own dedicated System User token, and has no
 * other overlap with the messaging code.
 *
 * A WhatsApp-sourced conversion is NOT a browser pixel event, so it
 * uses Meta's dedicated schema for messaging-attributed conversions
 * (`action_source: "business_messaging"` + `messaging_channel:
 * "whatsapp"`) rather than the `action_source: "website"` shape most
 * Conversions API examples show.
 * https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging
 */

import { createHash } from 'node:crypto'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/**
 * Meta requires PII fields in `user_data` (phone, email, ...) to
 * arrive pre-hashed — it never accepts them in plaintext. `phone` must
 * already be digits-only E.164 (see `sanitizePhoneForMeta`) with no
 * leading `+`, per Meta's normalization rules.
 */
export function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}

interface ConversionsConfig {
  datasetId: string
  accessToken: string
}

/**
 * Reads the dedicated Conversions API credentials from the
 * environment (see AskUserQuestion decision: env vars over a
 * per-account DB table, since this is a single-business deployment).
 * Throws with a clear message when either is missing so the caller's
 * try/catch surfaces an actionable log line instead of a confusing
 * downstream fetch failure.
 */
function getConversionsConfig(): ConversionsConfig {
  const datasetId = process.env.META_CONVERSIONS_DATASET_ID
  const accessToken = process.env.META_CONVERSIONS_API_TOKEN
  if (!datasetId || !accessToken) {
    throw new Error(
      'Meta Conversions API is not configured — set META_CONVERSIONS_DATASET_ID and META_CONVERSIONS_API_TOKEN.',
    )
  }
  return { datasetId, accessToken }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as { error?: { message?: string } }
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface SendPurchaseEventArgs {
  /** Digits-only E.164 phone (see `sanitizePhoneForMeta`) — hashed before sending. */
  phone: string
  /** `whatsapp_config.waba_id` for the account whose number the sale came in on. */
  wabaId: string
  /**
   * Sale amount. Omitted entirely (along with `currency`) when the
   * sale tag was added without a registered price — Meta still
   * accepts and counts the event, just without a purchase value.
   */
  value?: number
  currency?: string
  /**
   * Set only for the one-off manual verification pass (Events Manager
   * → Test Events). Never set on real sends — Meta excludes
   * test-coded events from production stats.
   */
  testEventCode?: string
}

/**
 * Report a WhatsApp sale as a `Purchase` event to Meta's Conversions
 * API, so ad campaigns that generated the lead get credited even
 * though the sale itself closes inside a WhatsApp conversation, never
 * on a page with a browser pixel.
 */
export async function sendPurchaseEvent(args: SendPurchaseEventArgs): Promise<void> {
  const { phone, wabaId, value, currency, testEventCode } = args
  const { datasetId, accessToken } = getConversionsConfig()

  const event: Record<string, unknown> = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      ph: [hashPhone(phone)],
      whatsapp_business_account_id: wabaId,
    },
  }
  if (typeof value === 'number') {
    event.custom_data = { value, currency: currency || 'USD' }
  }

  const body: Record<string, unknown> = { data: [event] }
  if (testEventCode) body.test_event_code = testEventCode

  const response = await fetch(`${META_API_BASE}/${datasetId}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta Conversions API error: ${response.status}`)
  }
}
