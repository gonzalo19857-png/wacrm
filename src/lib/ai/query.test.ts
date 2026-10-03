import { describe, it, expect } from 'vitest'
import { isLedConversation, latestUserMessage, retrievalQueryCandidates } from './query'

describe('isLedConversation', () => {
  it('is true once any message mentions LED lighting', () => {
    expect(
      isLedConversation([{ role: 'user', content: 'quiero un kit led para mi moto' }]),
    ).toBe(true)
  })

  it('stays true on a later turn with no LED keyword of its own', () => {
    expect(
      isLedConversation([
        { role: 'user', content: 'tienen focos led?' },
        { role: 'assistant', content: '¿Para qué vehículo sería?' },
        { role: 'user', content: 'Honda Tornado' },
      ]),
    ).toBe(true)
  })

  it('is false for a cobertor-only conversation', () => {
    expect(
      isLedConversation([{ role: 'user', content: 'quiero un cobertor para mi Kia Seltos' }]),
    ).toBe(false)
  })

  it('is true when the resolved ad campaign is LED, even with no LED keyword', () => {
    expect(isLedConversation([{ role: 'user', content: 'cuánto cuesta?' }], 'led')).toBe(true)
  })

  it('still falls back to the keyword check when the resolved ad campaign is cobertor', () => {
    expect(
      isLedConversation([{ role: 'user', content: 'tienen focos led?' }], 'cobertor'),
    ).toBe(true)
    expect(
      isLedConversation([{ role: 'user', content: 'cuánto cuesta?' }], 'cobertor'),
    ).toBe(false)
  })
})

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

  it('does not widen once a talla has already been recommended', () => {
    const messages = [
      { role: 'user' as const, content: 'Hyundai Tucson 2019' },
      {
        role: 'assistant' as const,
        content: 'Para su Hyundai Tucson recomendamos la *talla L* 😊',
      },
      { role: 'user' as const, content: 'Lima' },
    ]
    expect(retrievalQueryCandidates(messages)).toEqual(['Lima'])
  })

  it('still widens before any talla has been recommended', () => {
    const messages = [
      { role: 'user' as const, content: 'Hyundai Tucson' },
      { role: 'assistant' as const, content: '¿Para qué vehículo sería?' },
      { role: 'user' as const, content: '2019' },
    ]
    expect(retrievalQueryCandidates(messages)).toEqual([
      '2019',
      'Hyundai Tucson\n2019',
    ])
  })
})
