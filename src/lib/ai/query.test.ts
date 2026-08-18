import { describe, it, expect } from 'vitest'
import { latestUserMessage } from './query'

describe('latestUserMessage', () => {
  it('joins the last few user turns, oldest first', () => {
    expect(
      latestUserMessage([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'latest' },
      ]),
    ).toBe('first\nlatest')
  })

  it('caps the join at the given window, dropping older turns', () => {
    expect(
      latestUserMessage(
        [
          { role: 'user', content: 'one' },
          { role: 'user', content: 'two' },
          { role: 'user', content: 'three' },
        ],
        2,
      ),
    ).toBe('two\nthree')
  })

  it('falls back to the last message when none are user', () => {
    expect(
      latestUserMessage([{ role: 'assistant', content: 'only assistant' }]),
    ).toBe('only assistant')
  })

  it('returns empty string for no messages', () => {
    expect(latestUserMessage([])).toBe('')
  })
})
