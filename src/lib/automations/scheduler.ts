import { drainDuePendingExecutions } from './engine'
import { drainDueScheduledMessages } from '@/lib/contacts/scheduled-messages'

const INTERVAL_MS = 5 * 60 * 1000

declare global {
  // eslint-disable-next-line no-var
  var __automationSchedulerStarted: boolean | undefined
}

/**
 * Drains due automation Wait steps AND due pick-a-date recontact
 * sends (migration 077) every few minutes for as long as this server
 * process is alive. The app runs as a long-lived Docker container
 * (not a serverless function), so this one in-process interval
 * replaces needing an external pinger for /api/automations/cron —
 * see src/instrumentation.ts for where this gets started.
 *
 * Guarded by a global flag because Next dev's Fast Refresh can
 * re-execute module init more than once per process; without the
 * guard that would stack up duplicate intervals.
 */
export function startAutomationScheduler() {
  if (globalThis.__automationSchedulerStarted) return
  globalThis.__automationSchedulerStarted = true
  console.log(`[automations] scheduler started, draining every ${INTERVAL_MS / 60000}min`)

  const tick = async () => {
    try {
      const processed = await drainDuePendingExecutions()
      if (processed > 0) {
        console.log(`[automations] scheduler drained ${processed} pending execution(s)`)
      }
    } catch (err) {
      console.error('[automations] scheduler tick failed', err)
    }
    try {
      const sent = await drainDueScheduledMessages()
      if (sent > 0) {
        console.log(`[contacts] scheduler sent ${sent} scheduled recontact message(s)`)
      }
    } catch (err) {
      console.error('[contacts] scheduled-messages tick failed', err)
    }
  }

  setInterval(tick, INTERVAL_MS)
  void tick()
}
