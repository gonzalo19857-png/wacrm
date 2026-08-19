import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

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
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
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
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
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
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })
})
