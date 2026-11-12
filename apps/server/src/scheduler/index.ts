import { createDatabase } from '../db'
import type { Bindings } from '../env'
import { dispatchDue } from './dispatch'
import { dispatchKnowledge } from '../knowledge/runner'

export async function runScheduler(env: Bindings) {
  const db = createDatabase(env.DATABASE_URL)
  try {
    const results = await Promise.allSettled([dispatchDue(db, env), dispatchKnowledge(db, env)])
    if (results.some((r) => r.status === 'rejected')) throw new Error('Background dispatch failed.')
  }
  catch { throw new Error('Scheduler tick failed; pending deliveries will be retried.') }
  finally { await db.$disconnect() }
}
