/**
 * Runs once when a new server instance boots (see
 * node_modules/next/dist/docs/.../instrumentation.md — stable since
 * Next 15, no config flag needed). Used here to start the in-process
 * automation scheduler so Wait steps resolve without any external
 * cron/pinger — see src/lib/automations/scheduler.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startAutomationScheduler } = await import('@/lib/automations/scheduler')
  startAutomationScheduler()
}
