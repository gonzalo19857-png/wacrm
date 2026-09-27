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
import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'

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

export interface MetaConversionsConfig {
  datasetId: string
  accessToken: string
}

/**
 * Reads an account's Conversions API credentials from
 * `meta_conversions_configs` (migration 067). Originally these lived
 * in `META_CONVERSIONS_DATASET_ID` / `META_CONVERSIONS_API_TOKEN` env
 * vars, but those only exist on whatever machine someone happened to
 * edit `.env` on — never reliably present on every hosting setup this
 * app runs on. A DB-backed, admin-editable setting (same shape as
 * `sale_sheet_webhooks`) needs no server access to configure.
 *
 * Returns `null` — not a throw — when the account hasn't set this up
 * or has toggled it off: the feature is opt-in per account, not a
 * required piece of infra like `whatsapp_config`.
 */
export async function loadConversionsConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<MetaConversionsConfig | null> {
  const { data, error } = await db
    .from('meta_conversions_configs')
    .select('dataset_id, access_token, is_active')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[meta/conversions-api] failed to load config:', error)
    return null
  }
  if (!data || !data.is_active) return null
  return { datasetId: data.dataset_id, accessToken: decrypt(data.access_token) }
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
  /** Resolved via `loadConversionsConfig` — the caller decides whether the account has one configured. */
  config: MetaConversionsConfig
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
  const { config, phone, wabaId, value, currency, testEventCode } = args
  const { datasetId, accessToken } = config

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
