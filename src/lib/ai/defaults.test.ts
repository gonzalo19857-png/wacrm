import { describe, expect, it } from 'vitest'
import { limaTimeHint } from './defaults'

describe('limaTimeHint', () => {
  it('uses the real Peru weekday to set the Provincia dispatch promise', () => {
    // Saturday 2026-09-19, 10:00 in Peru (UTC-5).
    const saturdayPeru = Date.UTC(2026, 8, 19, 15, 0)
    expect(limaTimeHint(saturdayPeru)).toContain('48 horas')
    expect(limaTimeHint(saturdayPeru)).toContain('No expliques ni menciones el domingo')

    // Monday 2026-09-21, 10:00 in Peru (UTC-5).
    const mondayPeru = Date.UTC(2026, 8, 21, 15, 0)
    expect(limaTimeHint(mondayPeru)).toContain('24 horas')
    expect(limaTimeHint(mondayPeru)).toContain('No menciones un plazo de 48 horas')
  })

  it('computes today\'s remaining Lima delivery slots deterministically, instead of leaving the arithmetic to the model', () => {
    // 13:00 in Peru (UTC-5) — mañana (ends 12:00) has closed, tarde + noche remain.
    const oneOClockPeru = Date.UTC(2026, 8, 21, 18, 0)
    const twoLeft = limaTimeHint(oneOClockPeru)
    expect(twoLeft).toContain('Turno tarde: 2:00 pm – 4:00 pm')
    expect(twoLeft).toContain('Turno noche: 5:00 pm – 8:00 pm')
    expect(twoLeft).not.toContain('Turno mañana')
    expect(twoLeft).not.toContain('queda EXACTAMENTE 1')

    // 17:30 in Peru — tarde (ends 16:00) has also closed, only noche remains.
    const fiveThirtyPeru = Date.UTC(2026, 8, 21, 22, 30)
    const oneLeft = limaTimeHint(fiveThirtyPeru)
    expect(oneLeft).toContain('queda EXACTAMENTE 1 disponible — 🌆 Turno noche: 5:00 pm – 8:00 pm')
    expect(oneLeft).not.toContain('Turno tarde')

    // 21:00 in Peru — all three have closed.
    const ninePmPeru = Date.UTC(2026, 8, 22, 2, 0)
    const noneLeft = limaTimeHint(ninePmPeru)
    expect(noneLeft).toContain('ya no queda ninguno disponible')
  })
})
