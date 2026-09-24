import { describe, it, expect } from 'vitest'
import { extractDniFallback } from './sale-sheet'

describe('extractDniFallback', () => {
  it('finds an 8-digit DNI in a message that mentions "DNI"', () => {
    expect(extractDniFallback(['Pablo Aldave Vaca DNI 81609317 Número el mismo de WhatsApp'])).toBe(
      '81609317',
    )
  })

  it('prefers the most recent message that mentions DNI', () => {
    expect(
      extractDniFallback(['mi dni es 11111111', 'en realidad mi dni es 22222222']),
    ).toBe('22222222')
  })

  it('falls back to any standalone 8-digit token when no message says "DNI"', () => {
    expect(extractDniFallback(['Pablo Aldave Vaca 81609317'])).toBe('81609317')
  })

  it('never matches a 9-digit phone number', () => {
    expect(extractDniFallback(['mi numero es 987654321'])).toBeNull()
  })

  it('never matches inside a longer digit run', () => {
    expect(extractDniFallback(['pedido #123456789012'])).toBeNull()
  })

  it('returns null when nothing looks like a DNI', () => {
    expect(extractDniFallback(['hola, quiero un cobertor', 'para mi Kia Seltos'])).toBeNull()
  })
})
