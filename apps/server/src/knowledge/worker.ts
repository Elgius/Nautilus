import { DurableObject } from 'cloudflare:workers'
import { createDatabase } from '../db'
import type { Bindings } from '../env'
import { LEASE_MS, processKnowledgeStep } from './runner'

/** No public route exposes this binding. Only cron can wake a knowledge run. */
export class KnowledgeWorker extends DurableObject<Bindings> {
  async fetch(request: Request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/wake') return new Response(null, { status: 404 })
    const { runId } = await request.json<{ runId: string }>()
    if (typeof runId !== 'string' || !/^[\da-f-]{36}$/i.test(runId)) return new Response(null, { status: 400 })
    await this.ctx.storage.transaction(async (tx) => {
      const existing = await tx.get<string>('runId')
      if (existing && existing !== runId) throw new Error('Run identity mismatch.')
      await tx.put('runId', runId)
      if (await tx.getAlarm() === null) await tx.setAlarm(Date.now() + 100)
    })
    return Response.json({ accepted: true }, { status: 202 })
  }
  async alarm() {
    const runId = await this.ctx.storage.get<string>('runId')
    if (!runId) return
    // Keep a watchdog alarm while model/network I/O runs. Repeated cron wakes
    // cannot schedule a second alarm that consumes this run's next checkpoint.
    await this.ctx.storage.setAlarm(Date.now() + LEASE_MS + 1000)
    const db = createDatabase(this.env.DATABASE_URL)
    try {
      const nextAt = await processKnowledgeStep(db, this.env, runId)
      if (nextAt) await this.ctx.storage.setAlarm(nextAt)
      else {
        const run = await db.knowledgeRun.findUnique({ where: { id: runId }, select: { status: true, leaseExpiresAt: true, nextAttemptAt: true } })
        if (run?.status === 'running' && run.leaseExpiresAt) await this.ctx.storage.setAlarm(run.leaseExpiresAt.getTime() + 1000)
        else if (run?.status === 'pending') await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, run.nextAttemptAt.getTime()))
        else await this.ctx.storage.transaction(async (tx) => { await tx.deleteAlarm(); await tx.delete('runId') })
      }
    } finally { await db.$disconnect() }
  }
}
