import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { drainDuePendingExecutions } from '@/lib/automations/engine'

/**
 * Drain due `automation_pending_executions` rows. This is no longer
 * the only thing driving automation Wait steps — the app also drains
 * them itself every few minutes via the in-process scheduler (see
 * src/instrumentation.ts + src/lib/automations/scheduler.ts), so
 * nothing needs to hit this route for automations to work. It's kept
 * around for operators who'd rather point an external pinger at it
 * (Vercel Cron, a VPS crontab, ...) — requires a shared secret via
 * the `x-cron-secret` header to match `AUTOMATION_CRON_SECRET`.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const processed = await drainDuePendingExecutions()
  return NextResponse.json({ processed })
}
