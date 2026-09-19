import { describe, it, expect } from 'vitest'
import { matchCityInText } from './shalom-agencies'

const CITIES = ['Arequipa', 'Cusco', 'Trujillo', 'Huancayo', 'Cañete']

describe('matchCityInText', () => {
  it('matches a known city mentioned plainly', () => {
    expect(matchCityInText('Quisiera enviar a Arequipa por favor', CITIES)).toBe('Arequipa')
  })

  it('is case-insensitive', () => {
    expect(matchCityInText('AREQUIPA', CITIES)).toBe('Arequipa')
    expect(matchCityInText('arequipa', CITIES)).toBe('Arequipa')
  })

  it('is accent-insensitive', () => {
    expect(matchCityInText('lo mando a Canete', CITIES)).toBe('Cañete')
  })

  it('only matches whole words, not substrings', () => {
    // "Cusco" should not match inside an unrelated longer word.
    expect(matchCityInText('miscuscosas', CITIES)).toBeNull()
  })

  it('returns null when no known city is mentioned', () => {
    expect(matchCityInText('Quiero comprar una moto', CITIES)).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(matchCityInText('', CITIES)).toBeNull()
  })
})
