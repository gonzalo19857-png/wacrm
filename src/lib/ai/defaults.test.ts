import { describe, expect, it } from 'vitest'
import { limaTimeHint, selectBusinessPrompt } from './defaults'

describe('selectBusinessPrompt', () => {
  it('uses the LED prompt for a conversation detected as LED', () => {
    expect(
      selectBusinessPrompt(
        { systemPrompt: 'cobertor rules', ledSystemPrompt: 'led rules' },
        true,
      ),
    ).toBe('led rules')
  })

  it('uses the main prompt for a non-LED conversation', () => {
    expect(
      selectBusinessPrompt(
        { systemPrompt: 'cobertor rules', ledSystemPrompt: 'led rules' },
        false,
      ),
    ).toBe('cobertor rules')
  })

  it('never sends both prompts at once', () => {
    const result = selectBusinessPrompt(
      { systemPrompt: 'cobertor rules', ledSystemPrompt: 'led rules' },
      true,
    )
    expect(result).not.toContain('cobertor rules')
  })

  it('falls back to the main prompt when LED is detected but no LED prompt is configured yet', () => {
    expect(
      selectBusinessPrompt({ systemPrompt: 'cobertor rules', ledSystemPrompt: null }, true),
    ).toBe('cobertor rules')
  })

  it('falls back to the main prompt when the LED prompt is blank', () => {
    expect(
      selectBusinessPrompt({ systemPrompt: 'cobertor rules', ledSystemPrompt: '   ' }, true),
    ).toBe('cobertor rules')
  })
})

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
    expect(twoLeft).toContain('Turno tarde: 2:00 pm – 5:00 pm')
    expect(twoLeft).toContain('Turno noche: 6:00 pm – 8:00 pm')
    expect(twoLeft).not.toContain('Turno mañana')
    expect(twoLeft).not.toContain('queda EXACTAMENTE 1')

    // 17:30 in Peru — tarde (ends 17:00) has also closed, only noche remains.
    const fiveThirtyPeru = Date.UTC(2026, 8, 21, 22, 30)
    const oneLeft = limaTimeHint(fiveThirtyPeru)
    expect(oneLeft).toContain('queda EXACTAMENTE 1 disponible — 🌆 Turno noche: 6:00 pm – 8:00 pm')
    expect(oneLeft).not.toContain('Turno tarde')

    // 21:00 in Peru — all three have closed.
    const ninePmPeru = Date.UTC(2026, 8, 22, 2, 0)
    const noneLeft = limaTimeHint(ninePmPeru)
    expect(noneLeft).toContain('ya no queda ninguno disponible')
  })

  it('stops accepting same-day Lima orders at 6:00 pm even though "Turno noche" itself runs until 8:00 pm', () => {
    // 18:30 in Peru — past the 6:00 pm same-day cutoff, well before noche's own 20:00 end.
    const sixThirtyPeru = Date.UTC(2026, 8, 21, 23, 30)
    const hint = limaTimeHint(sixThirtyPeru)
    expect(hint).toContain('ya no queda ninguno disponible')
    expect(hint).toContain('6:00 pm')
    expect(hint).toContain('Ofrece los 3 turnos de MAÑANA')
    expect(hint).toContain('Turno mañana: 10:00 am – 12:00 pm')
    expect(hint).toContain('Turno tarde: 2:00 pm – 5:00 pm')
    expect(hint).toContain('Turno noche: 6:00 pm – 8:00 pm')
  })

  it('pushes Lima delivery slots to Monday when today is Sunday in Peru', () => {
    // Sunday 2026-09-20, 10:00 in Peru (UTC-5).
    const sundayPeru = Date.UTC(2026, 8, 20, 15, 0)
    const hint = limaTimeHint(sundayPeru)
    expect(hint).toContain('Hoy es domingo en Perú: no hay reparto en Lima los domingos')
    expect(hint).toContain('MAÑANA LUNES')
    expect(hint).toContain('Turno mañana: 10:00 am – 12:00 pm')
    expect(hint).toContain('Turno tarde: 2:00 pm – 5:00 pm')
    expect(hint).toContain('Turno noche: 6:00 pm – 8:00 pm')
  })
})
