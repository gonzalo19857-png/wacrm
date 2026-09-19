import { describe, it, expect } from 'vitest'
import { parseShipmentSentinel } from './shipment'

describe('parseShipmentSentinel', () => {
  it('parses every known key', () => {
    expect(
      parseShipmentSentinel(
        'region=provincia;city=Arequipa;agency=Shalom Mercaderes;name=Juan Perez;dni=12345678;phone=987654321;address=Av. Siempre Viva 123;reference=frente al parque;notes=Turno tarde 2-4pm',
      ),
    ).toEqual({
      region: 'provincia',
      city: 'Arequipa',
      agency: 'Shalom Mercaderes',
      name: 'Juan Perez',
      dni: '12345678',
      phone: '987654321',
      address: 'Av. Siempre Viva 123',
      reference: 'frente al parque',
      notes: 'Turno tarde 2-4pm',
    })
  })

  it('normalizes region to lowercase and rejects an unknown value', () => {
    expect(parseShipmentSentinel('region=LIMA').region).toBe('lima')
    expect(parseShipmentSentinel('region=marte').region).toBeNull()
  })

  it('leaves fields not present as null', () => {
    expect(parseShipmentSentinel('name=Juan')).toEqual({
      region: null,
      city: null,
      agency: null,
      name: 'Juan',
      dni: null,
      phone: null,
      address: null,
      reference: null,
      notes: null,
    })
  })

  it('ignores unknown keys and malformed pairs', () => {
    expect(parseShipmentSentinel('foo=bar;name=Juan;noequalsign;=blank')).toEqual({
      region: null,
      city: null,
      agency: null,
      name: 'Juan',
      dni: null,
      phone: null,
      address: null,
      reference: null,
      notes: null,
    })
  })

  it('drops keys with an empty value', () => {
    expect(parseShipmentSentinel('name=;dni=12345678').dni).toBe('12345678')
    expect(parseShipmentSentinel('name=;dni=12345678').name).toBeNull()
  })

  it('trims whitespace around keys and values', () => {
    expect(parseShipmentSentinel(' name = Juan Perez ; dni = 12345678 ')).toEqual(
      expect.objectContaining({ name: 'Juan Perez', dni: '12345678' }),
    )
  })

  it('parses a Lima delivery-slot note', () => {
    expect(parseShipmentSentinel('region=lima;address=Surco;notes=Hoy, turno tarde 2-4pm').notes).toBe(
      'Hoy, turno tarde 2-4pm',
    )
  })

  it('drops a name that is actually a place (parenthetical annotation)', () => {
    // Regression: a multi-line customer message ("NOMBRE=Carlos.../
    // LUGAR=Sullana (Piura)/Shalom (Zona Industrial)") got mismapped
    // live, with the city landing in `name` instead of the real name.
    expect(parseShipmentSentinel('city=PIURA;name=SULLANA (PIURA)').name).toBeNull()
  })

  it('drops a name that literally contains the city just parsed', () => {
    expect(parseShipmentSentinel('city=Trujillo;name=Trujillo').name).toBeNull()
  })

  it('keeps a normal name untouched', () => {
    expect(parseShipmentSentinel('city=Piura;name=Carlos Castillo').name).toBe('Carlos Castillo')
  })
})
