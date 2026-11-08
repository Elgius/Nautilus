import type { Database } from '../db'
import type { Bindings } from '../env'

export const MAX_ATTEMPTS = 8
export function retryDelay(attempts: number) { return Math.min(3_600_000, 60_000 * 2 ** Math.max(0, attempts - 1)) }
export async function claimDue(db: Database, now: Date) {
  return db.$transaction(async (tx) => {
    const schedules = await tx.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM "schedulerSchedule" s
      WHERE s.state IN ('pending', 'started') AND s."scheduledAt" <= ${now}
      AND EXISTS (SELECT 1 FROM "schedulerDelivery" d WHERE d."scheduleId" = s.id
        AND ((d.state = 'pending' AND d."nextAttemptAt" <= ${now})
          OR (d.state = 'dispatching' AND d."leaseExpiresAt" <= ${now})))
      ORDER BY s."scheduledAt", s.id LIMIT 4 FOR UPDATE OF s SKIP LOCKED`
    const claimed = []
    for (const { id } of schedules) {
      await tx.schedulerSchedule.update({ where: { id }, data: { state: 'started' } })
      const deliveries = await tx.schedulerDelivery.findMany({ where: { scheduleId: id, OR: [
        { state: 'pending', nextAttemptAt: { lte: now } }, { state: 'dispatching', leaseExpiresAt: { lte: now } },
      ] }, include: { schedule: { include: { event: true } } } })
      for (const delivery of deliveries) {
        if (delivery.attempts >= MAX_ATTEMPTS) {
          await tx.schedulerDelivery.update({ where: { id: delivery.id }, data: { state: 'failed', leaseToken: null, leaseExpiresAt: null, lastError: 'Delivery could not be confirmed. Check private agent history before retrying.' } })
          continue
        }
        const leaseToken = crypto.randomUUID()
        await tx.schedulerDelivery.update({ where: { id: delivery.id }, data: {
          state: 'dispatching', attempts: { increment: 1 }, leaseToken, leaseExpiresAt: new Date(now.getTime() + 120_000),
        } })
        claimed.push({ ...delivery, leaseToken, attempts: delivery.attempts + 1 })
      }
    }
    return claimed
  }, { timeout: 15_000 })
}

export async function dispatchDue(db: Database, env: Bindings, now = new Date()) {
  if (!env.ROOM_CHAT) throw new Error('Scheduler requires ROOM_CHAT.')
  const namespace = env.ROOM_CHAT
  const deliveries = await claimDue(db, now)
  // Bounded concurrent asynchronous I/O; no timer loop or model call in cron.
  const results = await Promise.allSettled(deliveries.map(async (delivery) => {
    const event = delivery.schedule.event
    let accepted = false
    let permanent = false
    try {
      const coordinator = namespace.get(namespace.idFromName(JSON.stringify([event.organizationId, event.roomId])))
      const response = await coordinator.fetch(new Request('https://room.internal/scheduler', {
        method: 'POST', body: JSON.stringify({ deliveryId: delivery.id, leaseToken: delivery.leaseToken }), signal: AbortSignal.timeout(20_000),
      }))
      accepted = response.ok
      permanent = response.status === 403 || response.status === 404
      await response.body?.cancel()
    } catch { /* retry ambiguous delivery with the same durable id */ }
    await db.schedulerDelivery.updateMany({ where: { id: delivery.id, leaseToken: delivery.leaseToken, state: 'dispatching' }, data: accepted
      ? { state: 'accepted', acceptedAt: new Date(), lastError: null, leaseToken: null, leaseExpiresAt: null }
      : { state: permanent || delivery.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', nextAttemptAt: new Date(Date.now() + retryDelay(delivery.attempts)),
          lastError: permanent ? 'Room access or agent assignment expired.' : 'Delivery could not be confirmed. Check private agent history before retrying.', leaseToken: null, leaseExpiresAt: null } })
  }))
  if (results.some((result) => result.status === 'rejected')) throw new Error('Scheduler checkpoint failed; expired leases will recover on the next tick.')
}
