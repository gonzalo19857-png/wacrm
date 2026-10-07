import { describe, it, expect } from 'vitest'
import { mergeConsecutive, toOpenAiChatMessage } from './shared'

describe('mergeConsecutive', () => {
  it('joins consecutive same-role text turns with a blank line', () => {
    const out = mergeConsecutive([
      { role: 'user', content: 'Hola' },
      { role: 'user', content: 'Kia Seltos' },
      { role: 'assistant', content: 'Hola, cuéntame más' },
    ])
    expect(out).toEqual([
      { role: 'user', content: 'Hola\n\nKia Seltos' },
      { role: 'assistant', content: 'Hola, cuéntame más' },
    ])
  })

  it('merges images from consecutive same-role turns', () => {
    const out = mergeConsecutive([
      { role: 'user', content: 'foto 1', images: ['data:image/jpeg;base64,AAA'] },
      { role: 'user', content: 'foto 2', images: ['data:image/jpeg;base64,BBB'] },
    ])
    expect(out).toEqual([
      {
        role: 'user',
        content: 'foto 1\n\nfoto 2',
        images: ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'],
      },
    ])
  })

  it('does not add an images field to a plain text-only merge', () => {
    const out = mergeConsecutive([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ])
    expect(out[0].images).toBeUndefined()
  })
})

describe('toOpenAiChatMessage', () => {
  it('passes plain text through as a bare string, unchanged', () => {
    expect(toOpenAiChatMessage({ role: 'user', content: 'hola' })).toEqual({
      role: 'user',
      content: 'hola',
    })
  })

  it('builds a text+image_url content-parts array when images are present', () => {
    expect(
      toOpenAiChatMessage({
        role: 'user',
        content: 'mira esto',
        images: ['data:image/jpeg;base64,AAA'],
      }),
    ).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'mira esto' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
      ],
    })
  })

  it('omits the text part when there is no caption, keeping only the image', () => {
    expect(
      toOpenAiChatMessage({ role: 'user', content: '', images: ['data:image/jpeg;base64,AAA'] }),
    ).toEqual({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } }],
    })
  })
})
