import { createDatabase } from '../db'
import type { Bindings } from '../env'
import { dispatchDue } from './dispatch'

export async function runScheduler(env: Bindings) {
  const db = createDatabase(env.DATABASE_URL)
  try { await dispatchDue(db, env) }
  catch { throw new Error('Scheduler tick failed; pending deliveries will be retried.') }
  finally { await db.$disconnect() }
}
