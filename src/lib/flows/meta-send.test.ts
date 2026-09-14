import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// engineSendMedia persists what it sent to Meta (regression).
//
// The customer received bot/Flow-sent photos fine — Meta got the link
// straight from `args.link` — but the inserted `messages` row never
// carried `media_url`, so the inbox rendered "Photo unavailable" for
// every image the AI auto-reply bot or a Flow sent. Drives the real
// `engineSendMedia` against a fake Supabase and asserts on the actual
// row it inserts, not on a mock being called.
// ============================================================

vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))

interface CapturedWrites {
  message?: Record<string, unknown>
}

function sendPathDb(captured: CapturedWrites): SupabaseClient {
  const contact = { id: 'ct-1', phone: '+15551234567' }
  const config = { id: 'cfg-1', phone_number_id: 'pn-1', access_token: 'token' }

  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') captured.message = row
          return builder
        },
        update: () => builder,
        maybeSingle: async () => {
          if (table === 'contacts') return { data: contact, error: null }
          return { data: null, error: null }
        },
        single: async () => {
          if (table === 'whatsapp_config') return { data: config, error: null }
          return { data: null, error: null }
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
}

const h = vi.hoisted(() => ({ db: null as SupabaseClient | null }))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => h.db,
}))

import { engineSendMedia } from './meta-send'

describe('engineSendMedia — persists media_url (bot/Flow image sends)', () => {
  it('stores the link it sent to Meta on the inserted message row', async () => {
    const captured: CapturedWrites = {}
    h.db = sendPathDb(captured)

    const result = await engineSendMedia({
      accountId: 'acct-1',
      userId: 'u-1',
      conversationId: 'cv-1',
      contactId: 'ct-1',
      kind: 'image',
      link: 'https://cdn.example/product.jpg',
      caption: 'Talla L',
      aiGenerated: true,
    })

    expect(result.whatsapp_message_id).toBe('wamid.media')
    // Was missing before the fix — the inbox had no URL to render even
    // though Meta (and therefore the customer) received the photo.
    expect(captured.message?.media_url).toBe('https://cdn.example/product.jpg')
    expect(captured.message?.content_type).toBe('image')
    expect(captured.message?.sender_type).toBe('bot')
  })
})
