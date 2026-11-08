import { expect, test } from 'bun:test'
import type { Database } from '../src/db'
import type { Bindings } from '../src/env'
import { canChat } from '../src/room-chat-service'
import { claimDue, dispatchDue, MAX_ATTEMPTS, retryDelay } from '../src/scheduler/dispatch'
import { eventInput, schedulerService } from '../src/scheduler/service'

const identity = { organizationId: 'org', roomId: 'room', userId: 'owner', sessionId: 'session' }
const future = () => new Date(Date.now() + 86_400_000).toISOString()
const input = () => ({ title: 'Review', instruction: 'Review the report', scheduledAt: future(), agentIds: ['agent'] })

test('schedule input requires a future explicit-offset time and distinct recipients', () => {
  expect(eventInput.safeParse(input()).success).toBe(true)
  for (const scheduledAt of ['2027-01-12T09:00:00', 'yesterday', '2020-01-01T00:00:00Z']) expect(eventInput.safeParse({ ...input(), scheduledAt }).success).toBe(false)
  expect(eventInput.safeParse({ ...input(), agentIds: ['agent', 'agent'] }).success).toBe(false)
  expect(eventInput.safeParse({ ...input(), ownerUserId: 'other' }).success).toBe(false)
})

function serviceDb() {
  let allowed = true
  let state = 'pending'
  let owner = 'owner'
  let created: unknown
  let changed = 0
  const db = {
    session: { findFirst: async () => ({ id: 'session' }) },
    roomMember: { findFirst: async () => allowed ? { organizationMemberId: 'member' } : null },
    roomAgent: { count: async () => 1 },
    schedulerEvent: { create: async (args: unknown) => { created = args; return args } },
    schedulerSchedule: {
      findFirst: async ({ where }: { where: { event: { ownerUserId: string } } }) => where.event.ownerUserId === owner ? { state } : null,
      update: async () => { changed++; return {} },
    },
    schedulerDelivery: { updateMany: async () => { changed++; return {} } },
    $queryRaw: async () => [],
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  }
  return { db: db as unknown as Database, revoke: () => { allowed = false }, start: () => { state = 'started' }, otherOwner: () => { owner = 'other' }, created: () => created, changed: () => changed }
}
test('creation uses trusted owner and room and rechecks membership', async () => {
  const h = serviceDb(), service = schedulerService(h.db, identity)
  await service.create(input())
  expect(h.created()).toMatchObject({ data: { organizationId: 'org', roomId: 'room', ownerUserId: 'owner' } })
  h.revoke()
  await expect(service.create(input())).rejects.toThrow('Room access expired')
})
test('cancel and reschedule cannot mutate another owner or a started schedule', async () => {
  const h = serviceDb(), service = schedulerService(h.db, identity)
  h.otherOwner()
  await expect(service.change('id')).rejects.toThrow('Schedule not found')
  expect(h.changed()).toBe(0)
  const started = serviceDb(); started.start()
  await expect(schedulerService(started.db, identity).change('id', future())).rejects.toThrow('already started')
  expect(started.changed()).toBe(0)
})
test('scheduled authorization survives session expiry but still requires scoped owner and membership', async () => {
  let calls = 0, allowed = true
  const db = {
    session: { findFirst: async () => { throw new Error('A scheduled event must not require an old session') } },
    schedulerDelivery: { findFirst: async ({ where }: { where: { schedule: { event: { organizationId: string; roomId: string; ownerUserId: string } } } }) => { calls++; expect(where.schedule.event).toEqual({ organizationId: 'org', roomId: 'room', ownerUserId: 'owner' }); return { id: 'delivery' } } },
    roomMember: { findFirst: async () => allowed ? { organizationMemberId: 'member' } : null },
  } as unknown as Database
  expect(await canChat(db, { ...identity, sessionId: '', scheduledDeliveryId: 'delivery' })).toBeTruthy()
  allowed = false
  expect(await canChat(db, { ...identity, sessionId: '', scheduledDeliveryId: 'delivery' })).toBeNull()
  expect(calls).toBe(2)
})

function dispatchDb(attempts = 0) {
  const writes: Array<{ where: { id: string }; data: Record<string, unknown> }> = []
  const rows = ['one', 'two'].map((id) => ({ id, attempts, schedule: { event: { organizationId: 'org', roomId: 'room' } } }))
  const db = {
    $queryRaw: async () => [{ id: 'schedule' }],
    schedulerSchedule: { update: async () => ({}) },
    schedulerDelivery: {
      findMany: async () => rows,
      update: async (args: typeof writes[number]) => { writes.push(args); return {} },
      updateMany: async (args: typeof writes[number]) => { writes.push(args); return { count: 1 } },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  }
  return { db: db as unknown as Database, writes }
}
test('dispatch sends recipients concurrently and checkpoints success independently from failure', async () => {
  const h = dispatchDb()
  const started: string[] = []
  let release!: () => void
  const bothStarted = new Promise<void>((resolve) => { release = resolve })
  const env = { ROOM_CHAT: { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    const { deliveryId } = await request.json() as { deliveryId: string }
    started.push(deliveryId)
    if (started.length === 2) release()
    await bothStarted
    return new Response(null, { status: deliveryId === 'one' ? 202 : 503 })
  } }) } } as unknown as Bindings
  await dispatchDue(h.db, env)
  expect(started).toHaveLength(2)
  expect(h.writes.find((w) => w.where.id === 'one' && w.data.state === 'accepted')).toBeTruthy()
  expect(h.writes.find((w) => w.where.id === 'two' && w.data.state === 'pending')).toBeTruthy()
  expect(h.writes.filter((w) => w.data.state === 'dispatching').every((w) => typeof w.data.leaseToken === 'string')).toBe(true)
})
test('exhausted expired deliveries become terminal and retry delays are capped', async () => {
  const h = dispatchDb(MAX_ATTEMPTS)
  expect(await claimDue(h.db, new Date())).toEqual([])
  expect(h.writes.every((w) => w.data.state === 'failed')).toBe(true)
  expect(retryDelay(1)).toBe(60_000)
  expect(retryDelay(8)).toBe(3_600_000)
})

test('pending schedules can be cancelled or moved before dispatch', async () => {
  const cancelled = serviceDb()
  await schedulerService(cancelled.db, identity).change('id')
  expect(cancelled.changed()).toBe(2)
  const moved = serviceDb()
  await schedulerService(moved.db, identity).change('id', future())
  expect(moved.changed()).toBe(2)
})

test('HTTP scheduling derives owner and room from authenticated context and rejects malformed bodies', async () => {
  const { Hono } = await import('hono')
  const { schedulerRoutes } = await import('../src/scheduler/routes')
  const { handleApiError } = await import('../src/api-error')
  const h = serviceDb()
  const app = new Hono<import('../src/index').AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', h.db)
    c.set('organizationId', 'org')
    c.set('session', { user: { id: 'owner' }, session: { id: 'session' } } as never)
    await next()
  })
  app.route('/rooms/:roomId/schedules', schedulerRoutes)
  app.onError(handleApiError)
  const response = await app.request('/rooms/room/schedules', { method: 'POST', body: JSON.stringify(input()), headers: { 'Content-Type': 'application/json' } })
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ data: { roomId: 'room', ownerUserId: 'owner' } })
  const spoofed = await app.request('/rooms/room/schedules', { method: 'POST', body: JSON.stringify({ ...input(), userId: 'other' }) })
  expect(spoofed.status).toBe(400)
  const malformed = await app.request('/rooms/room/schedules', { method: 'POST', body: '{' })
  expect(malformed.status).toBe(400)
})
