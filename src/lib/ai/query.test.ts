import { describe, it, expect } from 'vitest'
import { latestUserMessage, retrievalQueryCandidates } from './query'

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

describe('retrievalQueryCandidates', () => {
  it('tries the latest turn alone first, then the widened join', () => {
    const messages = [
      { role: 'user' as const, content: 'Hyundai Tucson' },
      { role: 'assistant' as const, content: 'reply' },
      { role: 'user' as const, content: 'Toyota Yaris 2019' },
    ]
    expect(retrievalQueryCandidates(messages)).toEqual([
      'Toyota Yaris 2019',
      'Hyundai Tucson\nToyota Yaris 2019',
    ])
  })

  it('is just the single candidate when there is only one user turn', () => {
    const messages = [{ role: 'user' as const, content: 'Toyota Yaris 2019' }]
    expect(retrievalQueryCandidates(messages)).toEqual(['Toyota Yaris 2019'])
  })
})
