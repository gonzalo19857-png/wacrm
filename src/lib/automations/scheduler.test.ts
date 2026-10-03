import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const drainDuePendingExecutions = vi.fn()
vi.mock('./engine', () => ({ drainDuePendingExecutions }))

const drainDueScheduledMessages = vi.fn()
vi.mock('@/lib/contacts/scheduled-messages', () => ({ drainDueScheduledMessages }))

describe('startAutomationScheduler', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    drainDuePendingExecutions.mockReset()
    drainDuePendingExecutions.mockResolvedValue(0)
    drainDueScheduledMessages.mockReset()
    drainDueScheduledMessages.mockResolvedValue(0)
    globalThis.__automationSchedulerStarted = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('drains immediately on start, then every 5 minutes', async () => {
    const { startAutomationScheduler } = await import('./scheduler')
    startAutomationScheduler()
    await vi.advanceTimersByTimeAsync(0)
    expect(drainDuePendingExecutions).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(drainDuePendingExecutions).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(drainDuePendingExecutions).toHaveBeenCalledTimes(3)
  })

  it('only starts one interval even if called twice', async () => {
    const { startAutomationScheduler } = await import('./scheduler')
    startAutomationScheduler()
    startAutomationScheduler()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    // one immediate tick each call would be 2; one interval firing once more is 3 total
    expect(drainDuePendingExecutions).toHaveBeenCalledTimes(2)
  })

  it('keeps ticking even if a drain call throws', async () => {
    drainDuePendingExecutions.mockRejectedValueOnce(new Error('boom'))
    const { startAutomationScheduler } = await import('./scheduler')
    startAutomationScheduler()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(drainDuePendingExecutions).toHaveBeenCalledTimes(2)
  })

  it('also drains due scheduled recontact messages each tick', async () => {
    const { startAutomationScheduler } = await import('./scheduler')
    startAutomationScheduler()
    await vi.advanceTimersByTimeAsync(0)
    expect(drainDueScheduledMessages).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(drainDueScheduledMessages).toHaveBeenCalledTimes(2)
  })

  it('still drains scheduled messages even if the automation drain throws', async () => {
    drainDuePendingExecutions.mockRejectedValueOnce(new Error('boom'))
    const { startAutomationScheduler } = await import('./scheduler')
    startAutomationScheduler()
    await vi.advanceTimersByTimeAsync(0)
    expect(drainDueScheduledMessages).toHaveBeenCalledTimes(1)
  })
})
