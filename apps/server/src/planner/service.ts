import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Database } from '../db'
import { canChat, scheduledTaskAvailable, type ChatIdentity } from '../room-chat-service'
import { guardRoomWrite } from '../documents/room-write-lock'
import { parseInput } from '../scheduler/service'

export const taskFields = z.strictObject({
  title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000),
  status: z.enum(['To do', 'In progress', 'In review', 'Done']),
  date: z.union([z.literal(''), z.iso.date()]),
  agentIds: z.array(z.string().min(1).max(100)).max(5).refine((ids) => new Set(ids).size === ids.length),
})
export const createTaskInput = taskFields.extend({ id: z.uuid() })
export const updateTaskInput = taskFields.partial().extend({ expectedRevision: z.number().int().positive() })
export type TaskFields = z.infer<typeof taskFields>
export function plannerService(db: Database, identity: ChatIdentity, actor?: { agentId: string; workToken: string; runId: string }) {
  const scope = { organizationId: identity.organizationId, roomId: identity.roomId }
  const authorize = async (source = db) => {
    if (!await canChat(source, identity) || !await scheduledTaskAvailable(source, identity)) throw new HTTPException(403, { message: 'Room access expired.' })
    if (actor && !await source.roomAgent.findFirst({ where: { ...scope, agentId: actor.agentId } })) throw new HTTPException(403, { message: 'Agent assignment expired.' })
  }
  const assigned = async (source: Pick<Database, 'roomAgent'>, agentIds: string[]) => {
    if (await source.roomAgent.count({ where: { ...scope, agentId: { in: agentIds } } }) !== agentIds.length) throw new HTTPException(400, { message: 'Choose agents assigned to this room.' })
  }
  const record = (tx: Pick<Database, 'plannerChange'>, task: { id: string; revision: number }, summary: string) => tx.plannerChange.create({ data: {
    taskId: task.id, revision: task.revision, userId: identity.userId, agentId: actor?.agentId, runId: actor?.runId,
    summary, snapshot: JSON.parse(JSON.stringify(task)),
  } })
  return {
    authorize,
    async list(after?: string) {
      await authorize()
      const tasks = await db.plannerTask.findMany({ where: { ...scope, deletedAt: null, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 101 })
      return { tasks: tasks.slice(0, 100), nextCursor: tasks.length > 100 ? tasks[99].id : null }
    },
    async read(id: string) {
      await authorize()
      const task = await db.plannerTask.findFirst({ where: { ...scope, id, deletedAt: null }, include: { changes: { orderBy: { revision: 'desc' }, take: 20 } } })
      if (!task) throw new HTTPException(404, { message: 'Task not found.' })
      return task
    },
    async create(input: unknown) {
      const { id, ...fields } = parseInput(createTaskInput, input)
      await authorize()
      return db.$transaction(async (tx) => {
        await guardRoomWrite(tx, scope, actor?.workToken)
        await authorize(tx as Database)
        const existing = await tx.plannerTask.findFirst({ where: { id } })
        if (existing) {
          if (existing.organizationId !== scope.organizationId || existing.roomId !== scope.roomId || existing.createdByUserId !== identity.userId || existing.deletedAt) throw new HTTPException(409, { message: 'Task ID already used.' })
          return existing
        }
        await assigned(tx, fields.agentIds)
        const task = await tx.plannerTask.create({ data: { id, ...scope, ...fields, createdByUserId: identity.userId } })
        await record(tx, task, 'Task created')
        return task
      })
    },
    async update(id: string, input: unknown, remove = false) {
      const { expectedRevision, ...fields } = parseInput(updateTaskInput, input)
      await authorize()
      return db.$transaction(async (tx) => {
        await guardRoomWrite(tx, scope, actor?.workToken)
        await authorize(tx as Database)
        if (fields.agentIds) await assigned(tx, fields.agentIds)
        const changed = await tx.plannerTask.updateMany({ where: { ...scope, id, deletedAt: null, revision: expectedRevision }, data: {
          ...fields, ...(remove ? { deletedAt: new Date() } : {}), revision: { increment: 1 },
        } })
        if (changed.count !== 1) throw new HTTPException(409, { message: 'Task changed. Reload it before editing.' })
        if (remove || fields.status === 'Done') {
          await tx.schedulerSchedule.updateMany({ where: { state: 'pending', event: { ...scope, taskId: id } }, data: { state: 'cancelled' } })
          await tx.schedulerDelivery.updateMany({ where: { state: 'pending', schedule: { state: 'cancelled', event: { ...scope, taskId: id } } }, data: { state: 'cancelled' } })
        }
        const task = await tx.plannerTask.findUniqueOrThrow({ where: { id } })
        await record(tx, task, remove ? 'Task deleted' : 'Task updated')
        return task
      })
    },
  }
}
