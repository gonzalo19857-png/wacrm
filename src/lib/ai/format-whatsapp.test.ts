import { describe, it, expect } from 'vitest'
import {
  enforceWhatsAppEmphasis,
  stripRepeatedRecommendation,
  guardAgainstUnfilledName,
} from './format-whatsapp'

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

  it('leaves an odd non-standard size label alone rather than corrupting it', () => {
    // Reproduces a real model slip: conflating the category into the
    // size code. A loose regex here wrapped only "SUV", leaving the
    // model's own asterisk and "-L" dangling as visible junk —
    // "*talla SUV*-L*". Matching nothing at all is the safe outcome.
    const odd = 'Para su Nissan Kicks recomendamos la *talla SUV-L* 😊'
    expect(enforceWhatsAppEmphasis(odd)).toBe(odd)
  })

  it('handles empty string', () => {
    expect(enforceWhatsAppEmphasis('')).toBe('')
  })
})

describe('stripRepeatedRecommendation', () => {
  const recommendation =
    'Para su Toyota Corolla 2018 recomendamos la *talla L* 😊\n' +
    'Precio: *S/129.90* 🎁\n\n' +
    '¿Por qué elegir nuestro cobertor? 🙌\n' +
    '✅ Doble Capa de Protección...\n' +
    '✅ Diseño Funcional...\n\n' +
    '¿En qué parte se encuentra? ¿Lima o provincia? 🙏'

  it('strips a re-stated recommendation, keeping only the new content', () => {
    const repeated =
      'Perfecto, ' +
      'para su Toyota Corolla recomendamos la *talla L* 😊\n' +
      'Precio: *S/129.90* 🎁\n\n' +
      '¿Por qué elegir nuestro cobertor? 🙌\n' +
      '✅ Doble Capa de Protección...\n' +
      '✅ Diseño Funcional...\n\n' +
      'Perfecto, en breve un asesor te contactará para coordinar tu pedido 🙌'

    expect(stripRepeatedRecommendation(repeated, [recommendation])).toBe(
      'Perfecto, en breve un asesor te contactará para coordinar tu pedido 🙌',
    )
  })

  it('is a no-op when the reply has no features block at all', () => {
    const text = '¿Para qué parte de Lima sería, estimado?'
    expect(stripRepeatedRecommendation(text, [recommendation])).toBe(text)
  })

  it('is a no-op the first time the features block is given (nothing prior to repeat)', () => {
    expect(stripRepeatedRecommendation(recommendation, [])).toBe(
      recommendation,
    )
  })

  it('is a no-op when it cannot find a blank line after the features block (unsafe to strip)', () => {
    const noBlankLine =
      '¿Por qué elegir nuestro cobertor? 🙌\n✅ Doble Capa de Protección...'
    expect(
      stripRepeatedRecommendation(noBlankLine, [recommendation]),
    ).toBe(noBlankLine)
  })

  it('falls back to the full text if stripping would leave nothing', () => {
    const trailingOnly =
      '¿Por qué elegir nuestro cobertor? 🙌\n✅ Doble Capa de Protección...\n\n   '
    expect(
      stripRepeatedRecommendation(trailingOnly, [recommendation]),
    ).toBe(trailingOnly)
  })

  it('keeps a corrected recommendation with a different price intact (vehicle reclassified)', () => {
    // Reproduces a real bug: the bot first quoted a moto lineal, then the
    // customer clarified it was actually a mototaxi — a different vehicle
    // with a different price. The corrected block shares the same fixed
    // features header as the earlier (wrong) one, but must NOT be
    // stripped down to just the trailing question, or the customer never
    // sees the corrected price.
    const motoLineal =
      'Para su moto Bajaj recomendamos la *talla M* 😊\n' +
      'Precio: *S/65.00* 🎁\n\n' +
      '¿Por qué elegir nuestro cobertor? 🙌\n' +
      '✅ Material PVC resistente\n' +
      '✅ Interior afelpado\n\n' +
      '¿En qué parte se encuentra? ¿Lima o provincia? 🙏'

    const correctedMototaxi =
      'Para su mototaxi Torito tenemos el cobertor 😊\n' +
      'Precio: *S/119.90* 🎁\n\n' +
      '¿Por qué elegir nuestro cobertor? 🙌\n' +
      '✅ Material PVC resistente\n' +
      '✅ Interior afelpado\n\n' +
      '¿En qué parte se encuentra? ¿Lima o provincia? 🙏'

    expect(
      stripRepeatedRecommendation(correctedMototaxi, [motoLineal]),
    ).toBe(correctedMototaxi)
  })
})

describe('guardAgainstUnfilledName', () => {
  it('swaps a Lima closing message that still has a literal [nombre] for a re-ask', () => {
    const broken =
      '¡Genial! 😊 Quedó registrado: a nombre de [nombre], turno tarde de hoy.\n\n' +
      'Perfecto, en breve un asesor se pondrá en contacto para coordinar su pedido 🙌'
    expect(guardAgainstUnfilledName(broken)).toBe(
      '¡Genial! 😊 Y para dejar todo listo, ¿a nombre de quién sería el pedido? 🙏',
    )
  })

  it('is a no-op when the reply has a real name, not the placeholder', () => {
    const text =
      '¡Genial! 😊 Quedó registrado: a nombre de Juan Perez, turno tarde de hoy.'
    expect(guardAgainstUnfilledName(text)).toBe(text)
  })

  it('is a no-op on text with no name reference at all', () => {
    const text = '¡Hola! ¿Para qué vehículo sería?'
    expect(guardAgainstUnfilledName(text)).toBe(text)
  })
})
