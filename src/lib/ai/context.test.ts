import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'
import { AI_VISION_MAX_IMAGES, AI_VISION_MAX_IMAGE_BYTES } from './defaults'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().in().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third', content_type: 'text' },
      { sender_type: 'agent', content_text: 'second', content_type: 'text' },
      { sender_type: 'customer', content_text: 'first', content_type: 'text' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply', content_type: 'text' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('queries both text and image content types, never just text', async () => {
    // Regression test: an earlier version filtered to content_type
    // 'text' only, which silently dropped the bot's own image+caption
    // recommendation from context on every later turn (auto-reply
    // sends the talla/price recommendation as one image message when
    // it attaches a product photo) — the model then had no memory of
    // having already answered and re-stated the same recommendation.
    let queriedTypes: unknown
    const chain = {
      from: () => chain,
      select: () => chain,
      eq: () => chain,
      in: (column: string, values: unknown) => {
        if (column === 'content_type') queriedTypes = values
        return chain
      },
      order: () => chain,
      limit: () => Promise.resolve({ data: [], error: null }),
    }
    await buildConversationContext(chain as unknown as SupabaseClient, 'conv-1')
    expect(queriedTypes).toEqual(expect.arrayContaining(['text', 'image']))
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ', content_type: 'text' },
        { sender_type: 'customer', content_text: null, content_type: 'text' },
        { sender_type: 'customer', content_text: 'real', content_type: 'text' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('keeps an uncaptioned customer image as an explicit context event', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'customer', content_text: null, content_type: 'image' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[El cliente envió una imagen.]' }])
  })

  describe('vision', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('downloads a mirrored (public URL) customer photo and attaches it as an image', async () => {
      const bytes = new Uint8Array([1, 2, 3])
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: async () => bytes.buffer,
          headers: new Headers({ 'content-type': 'image/jpeg' }),
        }),
      )
      const out = await buildConversationContext(
        fakeDb([
          {
            sender_type: 'customer',
            content_text: 'aquí está mi comprobante',
            content_type: 'image',
            media_url: 'https://xyz.supabase.co/storage/v1/object/public/chat-media/x.jpg',
            media_type: 'image/jpeg',
          },
        ]),
        'conv-1',
      )
      expect(out).toEqual([
        {
          role: 'user',
          content: 'aquí está mi comprobante',
          images: [`data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`],
        },
      ])
    })

    it('does not try to fetch the internal auth-gated proxy URL', async () => {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const out = await buildConversationContext(
        fakeDb([
          {
            sender_type: 'customer',
            content_text: null,
            content_type: 'image',
            media_url: '/api/whatsapp/media/12345',
            media_type: 'image/jpeg',
          },
        ]),
        'conv-1',
      )
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(out).toEqual([{ role: 'user', content: '[El cliente envió una imagen.]' }])
    })

    it('falls back to the text placeholder when the download fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
      const out = await buildConversationContext(
        fakeDb([
          {
            sender_type: 'customer',
            content_text: null,
            content_type: 'image',
            media_url: 'https://xyz.supabase.co/storage/v1/object/public/chat-media/x.jpg',
            media_type: 'image/jpeg',
          },
        ]),
        'conv-1',
      )
      expect(out).toEqual([{ role: 'user', content: '[El cliente envió una imagen.]' }])
    })

    it('falls back to the text placeholder when the photo exceeds the size cap', async () => {
      const oversized = new Uint8Array(AI_VISION_MAX_IMAGE_BYTES + 1)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          arrayBuffer: async () => oversized.buffer,
          headers: new Headers(),
        }),
      )
      const out = await buildConversationContext(
        fakeDb([
          {
            sender_type: 'customer',
            content_text: null,
            content_type: 'image',
            media_url: 'https://xyz.supabase.co/storage/v1/object/public/chat-media/x.jpg',
            media_type: 'image/jpeg',
          },
        ]),
        'conv-1',
      )
      expect(out).toEqual([{ role: 'user', content: '[El cliente envió una imagen.]' }])
    })

    it('only sends the most recent AI_VISION_MAX_IMAGES photos as vision, older ones stay placeholders', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([9]).buffer,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      })
      vi.stubGlobal('fetch', fetchSpy)
      const totalImages = AI_VISION_MAX_IMAGES + 2
      const rows = Array.from({ length: totalImages }, (_, i) => ({
        sender_type: 'customer' as const,
        content_text: null,
        content_type: 'image' as const,
        media_url: `https://xyz.supabase.co/storage/v1/object/public/chat-media/${i}.jpg`,
        media_type: 'image/jpeg',
      }))
      // fakeDb/the real query return newest-first; buildConversationContext reverses.
      const out = await buildConversationContext(fakeDb([...rows].reverse()), 'conv-1')

      expect(fetchSpy).toHaveBeenCalledTimes(AI_VISION_MAX_IMAGES)
      const withImages = out.filter((m) => m.images?.length)
      const placeholders = out.filter((m) => m.content === '[El cliente envió una imagen.]')
      expect(withImages).toHaveLength(AI_VISION_MAX_IMAGES)
      expect(placeholders).toHaveLength(totalImages - AI_VISION_MAX_IMAGES)
      // The ones that got real vision input are the most recent (last in
      // chronological order), not the oldest.
      expect(out.slice(-AI_VISION_MAX_IMAGES).every((m) => m.images?.length)).toBe(true)
    })
  })
})
