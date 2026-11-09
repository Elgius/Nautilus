import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Database } from '../db'
import { canChat, type ChatIdentity } from '../room-chat-service'

export const scheduleTime = z.iso.datetime({ offset: true }).refine((value) => new Date(value).getTime() > Date.now(), 'Choose a future time with an explicit UTC offset.')
export const eventInput = z.strictObject({
  taskId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  instruction: z.string().trim().min(1).max(12_000),
  scheduledAt: scheduleTime,
  agentIds: z.array(z.string().min(1).max(100)).min(1).max(5).refine((ids) => new Set(ids).size === ids.length, 'Choose distinct agents.'),
})
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new HTTPException(400, { message: result.error.issues[0]?.message ?? 'Invalid schedule.' })
  return result.data
}
export function schedulerService(db: Database, identity: ChatIdentity) {
  const scope = { organizationId: identity.organizationId, roomId: identity.roomId, ownerUserId: identity.userId }
  const authorize = async () => {
    if (!await canChat(db, identity)) throw new HTTPException(403, { message: 'Room access expired.' })
  }
  return {
    async create(input: unknown) {
      await authorize()
      const { agentIds, scheduledAt, requestId, ...content } = parseInput(eventInput, input)
      const create = async (source: Pick<Database, 'roomAgent' | 'schedulerEvent'>) => {
        const assigned = await source.roomAgent.count({ where: { organizationId: scope.organizationId, roomId: scope.roomId, agentId: { in: agentIds } } })
        if (assigned !== agentIds.length) throw new HTTPException(400, { message: 'Choose agents assigned to this room.' })
        return source.schedulerEvent.create({ data: { ...(requestId ? { id: requestId } : {}), ...scope, ...content, schedules: { create: {
          scheduledAt: new Date(scheduledAt), deliveries: { create: agentIds.map((agentId) => ({ organizationId: scope.organizationId, agentId, nextAttemptAt: new Date(scheduledAt) })) },
        } } }, include: { schedules: { include: { deliveries: true } } } })
      }
      if (!content.taskId && !requestId) return create(db)
      return db.$transaction(async (tx) => {
        // Serialize task completion/deletion with linked schedule creation.
        if (content.taskId) {
          await tx.$queryRaw`SELECT id FROM "plannerTask" WHERE id = ${content.taskId} AND "organizationId" = ${scope.organizationId} AND "roomId" = ${scope.roomId} FOR UPDATE`
          const task = await tx.plannerTask.findFirst({ where: { id: content.taskId, organizationId: scope.organizationId, roomId: scope.roomId, deletedAt: null, status: { not: 'Done' } } })
          if (!task) throw new HTTPException(409, { message: 'Choose an active task in this room.' })
          if (agentIds.some((id) => !task.agentIds.includes(id))) throw new HTTPException(400, { message: 'Schedule agents assigned to this task.' })
        }
        if (requestId) {
          const existing = await tx.schedulerEvent.findUnique({ where: { id: requestId }, include: { schedules: { include: { deliveries: true } } } })
          if (existing) {
            const schedule = existing.schedules[0]
            if (existing.ownerUserId !== scope.ownerUserId || existing.roomId !== scope.roomId || existing.organizationId !== scope.organizationId || existing.taskId !== (content.taskId ?? null) || existing.title !== content.title || existing.instruction !== content.instruction || schedule?.scheduledAt.getTime() !== new Date(scheduledAt).getTime() || [...schedule.deliveries.map((d) => d.agentId)].sort().join() !== [...agentIds].sort().join()) throw new HTTPException(409, { message: 'Schedule request ID already used.' })
            return existing
          }
        }
        return create(tx)
      })
    },
    async list(after?: string) {
      await authorize()
      const rows = await db.schedulerSchedule.findMany({ where: { event: scope, ...(after ? { id: { gt: after } } : {}) },
        include: { event: true, deliveries: { select: { id: true, agentId: true, state: true, attempts: true, acceptedAt: true, lastError: true, executionState: true, result: true, executionError: true } } }, orderBy: { id: 'asc' }, take: 51 })
      return { schedules: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null }
    },
    async change(id: string, scheduledAt?: string) {
      await authorize()
      const time = scheduledAt === undefined ? undefined : new Date(parseInput(scheduleTime, scheduledAt))
      return db.$transaction(async (tx) => {
        // The dispatcher takes this same lock. Once dispatch starts, cancellation
        // cannot promise to retract a job already accepted by a room coordinator.
        await tx.$queryRaw`SELECT s.id FROM "schedulerSchedule" s
          JOIN "schedulerEvent" e ON e.id = s."eventId"
          WHERE s.id = ${id} AND e."organizationId" = ${scope.organizationId}
            AND e."roomId" = ${scope.roomId} AND e."ownerUserId" = ${scope.ownerUserId}
          FOR UPDATE OF s`
        const schedule = await tx.schedulerSchedule.findFirst({ where: { id, event: scope } })
        if (!schedule) throw new HTTPException(404, { message: 'Schedule not found.' })
        if (schedule.state !== 'pending') throw new HTTPException(409, { message: 'This schedule has already started or been cancelled.' })
        await tx.schedulerDelivery.updateMany({ where: { scheduleId: id }, data: time ? { nextAttemptAt: time } : { state: 'cancelled' } })
        return tx.schedulerSchedule.update({ where: { id }, data: time ? { scheduledAt: time } : { state: 'cancelled' } })
      })
    },
  }
}
