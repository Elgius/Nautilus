import { expect, test } from 'bun:test'
import type { Database } from '../src/db'
import { createTaskInput, plannerService, taskFields } from '../src/planner/service'
import { schedulerService } from '../src/scheduler/service'
const identity = { organizationId: 'org', roomId: 'room', userId: 'user', sessionId: 'session' }
const id = 'c42bb233-85bc-49b4-9c94-e5af59bf06ca'
const fields = { title: 'Report', description: '', status: 'To do' as const, date: '2027-01-12', agentIds: ['agent'] }
function harness() {
  let allowed = true, locked = false, revisions = 1, writes = 0, cancellations = 0
  let saved: Record<string, unknown> | null = null
  const changes: unknown[] = []
  const db = {
    session: { findFirst: async () => ({ id: 'session' }) },
    roomMember: { findFirst: async () => allowed ? {} : null },
    roomAgent: { count: async () => 1, findFirst: async () => ({}) },
    room: { updateMany: async () => ({ count: locked ? 0 : 1 }) },
    plannerTask: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => saved ? (where.roomId && where.roomId !== saved.roomId ? null : { ...saved, revision: revisions }) : null,
      create: async ({ data }: { data: Record<string, unknown> }) => { writes++; saved = { ...data, revision: 1 }; return saved },
      updateMany: async ({ where, data }: { where: { expectedRevision?: number; revision: number }; data: Record<string, unknown> }) => {
        if (where.revision !== revisions) return { count: 0 }
        revisions++; writes++; saved = { ...saved, ...data, revision: revisions }; return { count: 1 }
      },
      findUniqueOrThrow: async () => saved,
    },
    plannerChange: { create: async (args: unknown) => { changes.push(args); return {} } },
    schedulerSchedule: { updateMany: async () => { cancellations++; return { count: 1 } } },
    schedulerDelivery: { updateMany: async () => ({ count: 1 }) },
    $queryRaw: async () => [],
    $transaction: async <T>(action: (tx: unknown) => Promise<T>) => action(db),
  }
  return { db: db as unknown as Database, revoke: () => { allowed = false }, lock: () => { locked = true }, writes: () => writes, changes, cancellations: () => cancellations }
}
test('task inputs validate real dates, statuses, assignments, and reject identity injection', () => {
  expect(createTaskInput.safeParse({ id, ...fields }).success).toBe(true)
  for (const patch of [{ date: '2027-02-30' }, { status: 'running' }, { agentIds: ['a', 'a'] }, { userId: 'other' }]) expect(taskFields.safeParse({ ...fields, ...patch }).success).toBe(false)
})
test('creation is idempotent and records a single shared change', async () => {
  const h = harness(), service = plannerService(h.db, identity)
  await service.create({ id, ...fields }); await service.create({ id, ...fields })
  expect(h.writes()).toBe(1); expect(h.changes).toHaveLength(1)
})
test('revoked membership and active room lease prevent manual writes', async () => {
  const h = harness(), service = plannerService(h.db, identity)
  h.revoke(); await expect(service.create({ id, ...fields })).rejects.toThrow('Room access expired')
  expect(h.writes()).toBe(0)
  const locked = harness(); locked.lock()
  await expect(plannerService(locked.db, identity).create({ id, ...fields })).rejects.toThrow('Agents are working')
  expect(locked.writes()).toBe(0)
})
test('stale revisions do not overwrite a task and Done cancels pending execution', async () => {
  const h = harness(), service = plannerService(h.db, identity)
  await service.create({ id, ...fields })
  await service.update(id, { expectedRevision: 1, status: 'In progress' })
  await expect(service.update(id, { expectedRevision: 1, title: 'Stale title' })).rejects.toThrow('Task changed')
  expect(h.writes()).toBe(2)
  await service.update(id, { expectedRevision: 2, status: 'Done' })
  expect(h.cancellations()).toBe(1)
})
test('a linked schedule rejects tasks outside its room and unassigned recipients', async () => {
  const h = harness()
  const service = schedulerService(h.db, identity)
  const schedule = { taskId: id, title: 'Run report', instruction: 'Prepare the report', agentIds: ['agent'], scheduledAt: new Date(Date.now() + 86400000).toISOString() }
  await expect(service.create(schedule)).rejects.toThrow('active task')
  await plannerService(h.db, identity).create({ id, ...fields })
  await expect(service.create({ ...schedule, agentIds: ['another-agent'] })).rejects.toThrow('assigned to this task')
})

test('scheduled task availability is scoped and checked independently of live identity', async () => {
  const { scheduledTaskAvailable } = await import('../src/room-chat-service')
  let active = true
  const db = { schedulerDelivery: { findFirst: async ({ where }: { where: { id: string; schedule: { event: Record<string, unknown> } } }) => {
    expect(where.id).toBe('delivery')
    expect(where.schedule.event).toMatchObject({ organizationId: 'org', roomId: 'room', ownerUserId: 'user', OR: [{ taskId: null }, { task: { deletedAt: null, status: { not: 'Done' } } }] })
    return active ? { id: 'delivery' } : null
  } } } as unknown as Database
  expect(await scheduledTaskAvailable(db, identity)).toBe(true)
  expect(await scheduledTaskAvailable(db, { ...identity, scheduledDeliveryId: 'delivery' })).toBe(true)
  active = false
  expect(await scheduledTaskAvailable(db, { ...identity, scheduledDeliveryId: 'delivery' })).toBe(false)
})
