import { describe, it, expect } from 'vitest'
import { enforceWhatsAppEmphasis } from './format-whatsapp'

describe('enforceWhatsAppEmphasis', () => {
  it('bolds an unbolded talla and price', () => {
    const out = enforceWhatsAppEmphasis(
      'Para su Toyota Yaris recomendamos la talla M 😊\nPrecio: S/124.90 🎁\n¿Por qué elegir?',
    )
    expect(out).toContain('*talla M*')
    expect(out).toContain('*S/124.90*')
  })

  it('is idempotent when the model already bolded correctly', () => {
    const already =
      'Para su Toyota Yaris recomendamos la *talla M* 😊\nPrecio: *S/124.90* 🎁\n\n¿Por qué elegir?'
    expect(enforceWhatsAppEmphasis(already)).toBe(already)
  })

  it('inserts a blank line after the price line when missing', () => {
    const out = enforceWhatsAppEmphasis('Precio: S/124.90 🎁\n¿Por qué elegir?')
    expect(out).toContain('*S/124.90* 🎁\n\n¿Por qué elegir?')
  })

  it('leaves an existing blank line after the price alone', () => {
    const withBlank = 'Precio: *S/124.90* 🎁\n\n¿Por qué elegir?'
    expect(enforceWhatsAppEmphasis(withBlank)).toBe(withBlank)
  })

  it('handles multiple size codes (XL, XXL, XXXL)', () => {
    const out = enforceWhatsAppEmphasis('la talla XXL cuesta S/89.90')
    expect(out).toContain('*talla XXL*')
    expect(out).toContain('*S/89.90*')
  })

  it('is a no-op on text with no talla or price', () => {
    const text = '¡Hola! ¿Para qué vehículo sería?'
    expect(enforceWhatsAppEmphasis(text)).toBe(text)
  })

  it('handles empty string', () => {
    expect(enforceWhatsAppEmphasis('')).toBe('')
  })
})
