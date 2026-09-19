import { describe, expect, it } from 'vitest'
import { limaTimeHint } from './defaults'

describe('limaTimeHint', () => {
  it('uses the real Peru weekday to set the Provincia dispatch promise', () => {
    // Saturday 2026-09-19, 10:00 in Peru (UTC-5).
    const saturdayPeru = Date.UTC(2026, 8, 19, 15, 0)
    expect(limaTimeHint(saturdayPeru)).toContain('48 horas')
    expect(limaTimeHint(saturdayPeru)).toContain('domingo no se trabaja')

    // Monday 2026-09-21, 10:00 in Peru (UTC-5).
    const mondayPeru = Date.UTC(2026, 8, 21, 15, 0)
    expect(limaTimeHint(mondayPeru)).toContain('24 horas')
    expect(limaTimeHint(mondayPeru)).not.toContain('domingo no se trabaja')
  })
})
