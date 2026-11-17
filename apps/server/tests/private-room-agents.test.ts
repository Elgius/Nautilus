import { AgentRunError } from '../src/skill-operation-error'
import { expect, test } from 'bun:test'
import { PrivateRoomAgents, type PrivateAgentMessage } from '../src/private-room-agents'
import type { ChatIdentity } from '../src/room-chat-service'
import type { AgentRunMode, PrivateAgentJob, PrivateAgentEvent } from '../../../shared/room-chat'
import { scheduleRoomAlarm } from '../src/room-alarm'

const alice: ChatIdentity = { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'alice-session' }
const bob = { ...alice, userId: 'bob', sessionId: 'bob-session' }
const profile = { id: 'scout', name: 'Scout', role: 'Research', rules: ['Cite sources'] }
function harness(options: { denyAgent?: boolean; fail?: boolean | Error; commitBeforeFailure?: boolean; gate?: Promise<void>; reply?: string; preview?: string; archive?: (identity: ChatIdentity, job: PrivateAgentJob) => Promise<void> } = {}) {
  const values = new Map<string, unknown>()
  let transactions: Promise<unknown> = Promise.resolve()
  const alarms: number[] = []
  const list = (source: Map<string, unknown>, { prefix, limit }: { prefix: string; limit?: number }) =>
    new Map([...source].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit))
  const store = {
    get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)) },
    delete: async (key: string) => values.delete(key),
    transaction: <T>(callback: (tx: unknown) => Promise<T>) => {
      const task = transactions.then(async () => {
        const local = new Map(values), changed = new Set<string>()
        const tx = {
          get: async <T>(key: string) => structuredClone(local.get(key)) as T | undefined,
          put: async (key: string, value: unknown) => { changed.add(key); local.set(key, structuredClone(value)) },
          delete: async (key: string) => { changed.add(key); return local.delete(key) },
          list: async (options: { prefix: string; limit?: number }) => list(local, options),
          getAlarm: async () => local.get('@alarm') ?? null,
          setAlarm: async (at: number) => { alarms.push(at); changed.add('@alarm'); local.set('@alarm', at) },
        }
        const result = await callback(tx)
        for (const key of changed) { if (local.has(key)) values.set(key, local.get(key)); else values.delete(key) }
        return result
      })
      transactions = task.catch(() => {})
      return task
    },
    getAlarm: async () => values.get('@alarm') ?? null,
    setAlarm: async (at: number) => { alarms.push(at); values.set('@alarm', at) },
    list: async (options: { prefix: string; limit?: number }) => list(values, options),
  }
  const events: { userId: string; scheduledDeliveryId?: string; event: PrivateAgentEvent }[] = []
  const tasks: Promise<void>[] = []
  const calls: PrivateAgentMessage[][] = []
  let allowed = true
  const deps: ConstructorParameters<typeof PrivateRoomAgents>[0] = {
    storage: store as unknown as DurableObjectStorage,
    archive: options.archive,
    canAccess: async () => allowed,
    acquire: async () => true,
    release: async () => {},
    profile: async (identity, id) => !options.denyAgent && identity.organizationId === 'org' && id === profile.id ? profile : null,
    stream: async function* (_profile, messages, signal, _identity, run) {
      calls.push(messages)
      if (calls.length === 1) await options.gate
      signal.throwIfAborted()
      if (options.preview) await run.preview?.('write', options.preview)
      if (options.commitBeforeFailure && calls.length === 1) await run.committed({ documentId: 'doc', versionId: 'v2', versionNumber: 2 })
      if (options.fail) throw options.fail instanceof Error ? options.fail : new Error('PROVIDER_SECRET_AND_PROMPT')
      yield options.reply ?? 'Private response'
    },
    send: async (identity, event) => { if (allowed) events.push({ userId: identity.userId, scheduledDeliveryId: identity.scheduledDeliveryId, event: structuredClone(event) }) },
    waitUntil: (task) => { tasks.push(task) },
  }
  const service = new PrivateRoomAgents(deps)
  const invoke = async (identity = alice, instruction = 'Alice secret', id = crypto.randomUUID(), mode: AgentRunMode = 'write') => {
    await service.invoke(identity, { requestId: id, agentId: profile.id, instruction, mode, userId: 'attacker' })
    // Let nonblocking acceptance and mocked I/O settle without awaiting a gated run.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { service, invoke, deps, alarms, values, events, calls, tasks, restart: () => new PrivateRoomAgents(deps), revoke: () => { allowed = false } }
}

test('document previews are ephemeral and sent only through the requesting user’s private channel', async () => {
  const h = harness({ preview: 'PRIVATE_UNREVIEWED_DOCUMENT_TEXT' })
  await h.invoke({ ...alice, name: 'Alice' }); await Promise.all(h.tasks)
  const previews = h.events.filter(({ event }) => event.type === 'agent.document-preview')
  expect(previews).toHaveLength(1)
  expect(previews[0]).toMatchObject({ userId: 'alice', event: { type: 'agent.document-preview', toolCallId: 'write', input: 'PRIVATE_UNREVIEWED_DOCUMENT_TEXT', author: { agentId: 'scout', agentName: 'Scout', requestedBy: { id: 'alice', name: 'Alice' } } } })
  expect(JSON.stringify([...h.values.values()])).not.toContain('PRIVATE_UNREVIEWED_DOCUMENT_TEXT')
  expect(await h.service.history(bob)).toEqual([])
})

test('private instructions and history are scoped to the authenticated user', async () => {
  const h = harness()
  const id = crypto.randomUUID()
  await h.invoke(alice, 'ALICE_SECRET', id); await Promise.all(h.tasks)
  expect(h.events.every((item) => item.userId === 'alice')).toBe(true)
  expect((await h.service.history(alice))[0]).toMatchObject({ instruction: 'ALICE_SECRET', status: 'complete', reply: 'Private response' })
  expect(await h.service.history(bob)).toEqual([])
  await h.invoke(bob, 'BOB_SECRET', id); await Promise.all(h.tasks)
  expect((await h.service.history(alice)).map((job) => job.instruction)).toEqual(['ALICE_SECRET'])
  expect((await h.service.history(bob)).map((job) => job.instruction)).toEqual(['BOB_SECRET'])
  expect(h.calls).toHaveLength(2)
  expect(JSON.stringify(h.calls[1])).not.toContain('ALICE_SECRET')
})

test('duplicate private invocations reuse a completed response without another model call', async () => {
  const h = harness(), id = crypto.randomUUID()
  await h.invoke(alice, 'Private instruction', id); await Promise.all(h.tasks)
  await h.invoke(alice, 'Private instruction', id)
  expect(h.calls).toHaveLength(1)
  expect(await h.service.history(alice)).toHaveLength(1)
  await expect(h.invoke(alice, 'different instruction', id)).rejects.toThrow('Invalid reuse')
})

test('agent conversation context contains only this user’s completed turns with this agent', async () => {
  const h = harness()
  await h.invoke(alice, 'First instruction'); await Promise.all(h.tasks)
  await h.invoke(bob, 'Other user secret'); await Promise.all(h.tasks)
  await h.invoke(alice, 'Follow-up'); await Promise.all(h.tasks)
  expect(h.calls[2]).toEqual([
    { role: 'user', content: 'First instruction' },
    { role: 'assistant', content: 'Private response' },
    { role: 'user', content: 'Follow-up' },
  ])
})

test('unassigned agents and invalid instructions never reach the model or private storage', async () => {
  const h = harness({ denyAgent: true })
  await expect(h.invoke()).rejects.toMatchObject({ code: 'AGENT_ACCESS_DENIED' })
  expect(h.calls).toHaveLength(0); expect(h.values.size).toBe(0)
  await expect(h.service.invoke(alice, { requestId: 'invalid', agentId: 'scout', instruction: 'secret' })).rejects.toThrow('Invalid message ID')
  await expect(h.invoke(alice, ' '.repeat(10))).rejects.toThrow('Enter a message')
})

test('model failures are private, sanitized, persisted and safely retryable with a new ID', async () => {
  const h = harness({ fail: true })
  await h.invoke(); await Promise.all(h.tasks)
  const [job] = await h.service.history(alice)
  expect(job.status).toBe('failed')
  expect(job.errorCode).toBe('INTERNAL_ERROR')
  expect(job.error).toBe('The request could not be completed. Try again.')
  expect(JSON.stringify(h.events)).not.toContain('PROVIDER_SECRET')
  expect(await h.service.history(bob)).toEqual([])
})

test('interrupted work is marked failed after coordinator restart instead of being rerun', async () => {
  const h = harness()
  await h.invoke(); await Promise.all(h.tasks)
  for (const [key, value] of h.values) {
    if (key.includes(':job:')) h.values.set(key, { ...(value as object), status: 'running' })
  }
  const [job] = await h.service.history(alice)
  expect(job.status).toBe('failed'); expect(job.error).toContain('interrupted')
  expect(h.calls).toHaveLength(1)
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
async function settle(tasks: Promise<void>[]) {
  for (let index = 0; index < tasks.length; index++) await tasks[index]
}

test('multiple users queue requests while one moderator owns execution', async () => {
  const gate = deferred(), h = harness({ gate: gate.promise })
  const first = crypto.randomUUID(), second = crypto.randomUUID(), third = crypto.randomUUID()
  await h.invoke(alice, 'First', first)
  await h.invoke(bob, 'Second', second)
  await h.invoke(alice, 'Third', third)
  expect((await h.service.history(bob))[0].status).toBe('queued')
  expect((await h.service.activity()).queued).toBe(2)
  await waitFor(() => h.calls.length === 1)
  expect(h.calls).toHaveLength(1)
  gate.resolve(); await settle(h.tasks)
  expect(h.calls.map((messages) => messages.at(-1)?.content)).toEqual(['First', 'Second', 'Third'])
  expect((await h.service.history(alice)).every((job) => job.status === 'complete')).toBe(true)
  expect((await h.service.activity()).activities).toEqual([])
})

test('queued cancellation is owner-scoped and does not start the cancelled model', async () => {
  const gate = deferred(), h = harness({ gate: gate.promise })
  const first = crypto.randomUUID(), second = crypto.randomUUID()
  await h.invoke(alice, 'First', first); await h.invoke(bob, 'Second', second)
  await h.service.cancel(alice, second)
  expect((await h.service.history(bob))[0].status).toBe('queued')
  await h.service.cancel(bob, second)
  expect((await h.service.history(bob))[0]).toMatchObject({ status: 'failed', errorCode: 'RUN_CANCELLED' })
  gate.resolve(); await settle(h.tasks)
  expect(h.calls).toHaveLength(1)
})

test('browser cancellation preserves a queued scheduled job’s delivery identity across restart', async () => {
  const gate = deferred(), h = harness({ gate: gate.promise })
  const id = crypto.randomUUID()
  await h.invoke(bob, 'Blocking work')
  await h.service.invoke({ ...alice, sessionId: '', scheduledDeliveryId: id }, { requestId: id, agentId: profile.id, instruction: 'Scheduled work' }, true)
  await h.service.cancel(bob, id)
  expect((await h.service.history(alice))[0].status).toBe('queued')
  await h.service.cancel(alice, id)
  expect(h.events.findLast(({ event }) => event.type === 'agent.update' && event.job.id === id)).toMatchObject({ userId: 'alice', scheduledDeliveryId: id,
    event: { type: 'agent.update', job: { id, status: 'failed', errorCode: 'RUN_CANCELLED' } } })
  expect((await h.restart().history(alice))[0].status).toBe('failed')
  gate.resolve(); await settle(h.tasks)
  expect(h.calls).toHaveLength(1)
})

test('active cancellation releases execution and the next queued request finishes', async () => {
  const gate = deferred(), h = harness({ gate: gate.promise })
  const first = crypto.randomUUID()
  await h.invoke(alice, 'First', first); await h.invoke(bob, 'Second')
  await h.service.cancel(alice, first)
  gate.resolve(); await settle(h.tasks)
  expect((await h.service.history(alice))[0].error).toContain('Cancelled')
  expect((await h.service.history(bob))[0].status).toBe('complete')
})

test('durable queued entries run after a fresh coordinator is created', async () => {
  const h = harness(), id = crypto.randomUUID()
  await h.invoke(alice, 'Survives restart', id); await settle(h.tasks)
  const key = `private-agent:alice:job:${id}`
  h.values.set(key, { ...(h.values.get(key) as object), status: 'queued', reply: '' })
  h.values.set('room-work:queue', [{ identity: alice, id }])
  const restarted = h.restart()
  expect((await restarted.history(alice))[0].status).toBe('queued')
  restarted.wake(); await settle(h.tasks)
  expect((await restarted.history(alice))[0].status).toBe('complete')
  expect(h.calls).toHaveLength(2)
})

test('orphaned running work waits for its lease then fails without replaying saved edits', async () => {
  const h = harness(), id = crypto.randomUUID()
  await h.invoke(alice, 'Partially saved', id); await settle(h.tasks)
  const key = `private-agent:alice:job:${id}`
  const commits = [{ documentId: 'doc', versionId: 'saved', versionNumber: 2 }]
  h.values.set(key, { ...(h.values.get(key) as object), status: 'running', commits })
  const entry = { identity: alice, id, token: 'old-lease', deadline: Date.now() + 240_000 }
  h.values.set('room-work:queue', [entry])
  const restarted = h.restart()
  restarted.wake(); await settle(h.tasks)
  expect((await restarted.history(alice))[0].status).toBe('running')
  h.values.set('room-work:queue', [{ ...entry, deadline: 0 }])
  restarted.wake(); await settle(h.tasks)
  expect((await restarted.history(alice))[0]).toMatchObject({ status: 'failed', commits })
  expect(h.calls).toHaveLength(1)
})


test('Unicode replies cannot overflow durable job storage and retain a safe failure record', async () => {
  const h = harness({ reply: '漢'.repeat(32_000) })
  await h.invoke(alice, '漢'.repeat(20_000)); await settle(h.tasks)
  const [job] = await h.service.history(alice)
  expect(job.status).toBe('failed')
  expect(new TextEncoder().encode(JSON.stringify(job)).byteLength).toBeLessThan(110_000)
})

test('scheduled delivery receipts survive history pruning and coordinator restart', async () => {
  const h = harness()
  const id = crypto.randomUUID()
  const identity = { ...alice, scheduledDeliveryId: id, sessionId: '' }
  const input = { requestId: id, agentId: profile.id, instruction: 'Scheduled task' }
  await h.service.invoke(identity, input, true)
  await Promise.all(h.tasks)
  const count = h.calls.length
  // Simulate normal history pruning while preserving the durable receipt.
  for (const key of h.values.keys()) if (key.includes(`job:${id}`)) h.values.delete(key)
  await h.restart().invoke(identity, input, true)
  await Promise.all(h.tasks)
  expect(h.calls).toHaveLength(count)
  expect(h.values.get(`scheduler:receipt:${id}`)).toBe(true)
})

test('scheduled execution excludes earlier unrelated private conversation', async () => {
  const h = harness()
  await h.invoke(); await Promise.all(h.tasks)
  const id = crypto.randomUUID()
  await h.service.invoke({ ...alice, scheduledDeliveryId: id }, { requestId: id, agentId: profile.id, instruction: 'Future authorized task' }, true)
  await Promise.all(h.tasks)
  expect(h.calls[1]).toEqual([{ role: 'user', content: 'Future authorized task' }])
})

test('Ask finishes beside a blocked writer without acquiring or releasing a write lease', async () => {
  const gate = deferred(), h = harness({ gate: gate.promise })
  const leases: string[] = []
  h.deps.acquire = async (_identity, token) => { leases.push(token); return true }
  h.deps.release = async (_identity, token) => { leases.push(`release:${token}`) }
  await h.invoke(alice, 'Long write')
  const id = crypto.randomUUID()
  await h.invoke(bob, 'Quick question', id, 'read')
  expect((await h.service.history(bob))[0]).toMatchObject({ status: 'complete', mode: 'read' })
  expect((await h.service.history(alice))[0].status).toBe('running')
  expect(leases).toHaveLength(1)
  gate.resolve(); await settle(h.tasks)
  expect(leases).toHaveLength(2)
})

test('Ask slots are bounded to three per room and two per user; cancellation releases only its slot', async () => {
  const h = harness(), gates = new Map<string, ReturnType<typeof deferred>>()
  h.deps.stream = async function* (_profile, _messages, signal, _identity, run) {
    const gate = deferred(); gates.set(run.id, gate)
    await Promise.race([gate.promise, new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))])
    signal.throwIfAborted(); yield 'Answer'
  }
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID())
  await h.invoke(alice, 'A1', ids[0], 'read'); await h.invoke(alice, 'A2', ids[1], 'read')
  await h.invoke(alice, 'A3', ids[2], 'read'); await h.invoke(bob, 'B1', ids[3], 'read')
  await h.invoke(bob, 'B2', ids[4], 'read')
  expect([...gates.keys()]).toEqual([ids[0], ids[1], ids[3]])
  expect((await h.service.activity()).activities).toHaveLength(3)
  await h.service.cancel(bob, ids[0])
  expect((await h.service.history(alice))[0].status).toBe('running')
  await h.service.cancel(alice, ids[0])
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect((await h.service.history(alice))[0].status).toBe('failed')
  expect(gates.has(ids[2])).toBe(true)
  expect((await h.service.history(bob))[0].status).toBe('running')
  gates.get(ids[1])!.resolve(); gates.get(ids[2])!.resolve(); gates.get(ids[3])!.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  gates.get(ids[4])!.resolve(); await settle(h.tasks)
  expect((await h.service.activity()).activities).toEqual([])
})

test('changing a deduplicated request mode is rejected and scheduled requests remain writers', async () => {
  const h = harness(), id = crypto.randomUUID()
  await h.invoke(alice, 'Question', id, 'read'); await settle(h.tasks)
  await expect(h.invoke(alice, 'Question', id, 'write')).rejects.toThrow('Invalid reuse')
  await expect(h.service.invoke(alice, { requestId: crypto.randomUUID(), agentId: profile.id, instruction: 'Question', mode: 'auto' })).rejects.toThrow('Invalid request mode')
  const scheduled = crypto.randomUUID()
  await h.service.invoke({ ...alice, scheduledDeliveryId: scheduled }, { requestId: scheduled, agentId: profile.id, instruction: 'Work', mode: 'read' }, true)
  await settle(h.tasks)
  expect((await h.service.history(alice)).find((job) => job.id === scheduled)?.mode).toBe('write')
})

test('queued Ask requests survive restart; orphaned reads never replay and do not hold the write lane', async () => {
  const h = harness(), id = crypto.randomUUID()
  await h.invoke(alice, 'Question', id, 'read'); await settle(h.tasks)
  const key = `private-agent:alice:job:${id}`
  h.values.set(key, { ...(h.values.get(key) as object), status: 'queued', reply: '' })
  h.values.set('room-work:queue', [{ identity: alice, id, mode: 'read' }])
  const restarted = h.restart(); restarted.wake(); await settle(h.tasks)
  expect((await restarted.history(alice))[0].status).toBe('complete')
  const calls = h.calls.length
  h.values.set(key, { ...(h.values.get(key) as object), status: 'running' })
  h.values.set('room-work:queue', [{ identity: alice, id, mode: 'read', token: 'orphan', deadline: Date.now() + 240_000 }])
  const orphaned = h.restart(); orphaned.wake(); await settle(h.tasks)
  expect((await orphaned.history(alice))[0].status).toBe('running')
  expect(h.calls).toHaveLength(calls)
  await orphaned.invoke(bob, { requestId: crypto.randomUUID(), agentId: profile.id, instruction: 'Write' }); await settle(h.tasks)
  expect((await orphaned.history(bob))[0].status).toBe('complete')
  h.values.set('room-work:queue', [{ identity: alice, id, mode: 'read', token: 'orphan', deadline: 0 }])
  orphaned.wake(); await settle(h.tasks)
  expect((await orphaned.history(alice))[0].status).toBe('failed')
  expect(h.calls).toHaveLength(calls + 1)
})

test('slow acceptance notifications do not delay model startup', async () => {
  const h = harness(), delivery = deferred(), model = deferred()
  h.deps.send = async () => { await delivery.promise }
  h.deps.changed = async () => { await delivery.promise }
  h.deps.stream = async function* () { model.resolve(); yield 'Immediate answer' }
  await h.invoke()
  await model.promise
  delivery.resolve(); await settle(h.tasks)
  expect((await h.service.history(alice))[0].status).toBe('complete')
})

test('slow streamed deliveries do not block model consumption and terminal revisions stay ordered', async () => {
  const h = harness(), delivery = deferred(), sending = deferred(), consumed = deferred(), finish = deferred()
  const original = h.deps.send
  h.deps.send = async (identity, event) => {
    if (event.type === 'agent.update' && event.job.status === 'running' && event.job.reply) {
      sending.resolve(); await delivery.promise
    }
    await original(identity, event)
  }
  h.deps.stream = async function* () {
    yield 'A'; await sending.promise
    yield 'B'; consumed.resolve(); await finish.promise
  }
  await h.invoke()
  await consumed.promise
  expect(h.events.some(({ event }) => event.type === 'agent.update' && event.job.reply)).toBe(false)
  delivery.resolve(); finish.resolve(); await settle(h.tasks)
  const updates = h.events.flatMap(({ event }) => event.type === 'agent.update' ? [event.job] : [])
  expect(updates.at(-1)).toMatchObject({ reply: 'AB', status: 'complete' })
  expect(updates.map((job) => job.revision)).toEqual(updates.map((job) => job.revision).toSorted((a, b) => a - b))
  expect((await h.service.history(alice))[0]).toMatchObject({ reply: 'AB', status: 'complete' })
})

test('presence and watchdog scheduling cannot postpone queue retry alarms', async () => {
  const h = harness(), now = Date.now()
  await Promise.all([
    scheduleRoomAlarm(h.deps.storage, now + 30_000),
    scheduleRoomAlarm(h.deps.storage, now + 1000),
    scheduleRoomAlarm(h.deps.storage, now + 240_000),
    scheduleRoomAlarm(h.deps.storage, now + 5000),
  ])
  expect(h.values.get('@alarm')).toBe(now + 1000)
  // Model the platform consuming the alarm, then schedule its next deadline.
  h.values.delete('@alarm')
  await scheduleRoomAlarm(h.deps.storage, now + 5000)
  await scheduleRoomAlarm(h.deps.storage, now + 30_000)
  expect(h.values.get('@alarm')).toBe(now + 5000)
})

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 1))
  expect(check()).toBe(true)
}

test('archive outbox survives database outage and coordinator restart without failing agent work', async () => {
  let failing = true
  const archived: { userId: string; job: PrivateAgentJob }[] = []
  const h = harness({ archive: async (identity, job) => {
    if (failing) throw new Error('database unavailable')
    archived.push({ userId: identity.userId, job: structuredClone(job) })
  } })
  const id = crypto.randomUUID()
  await h.invoke(alice, 'Keep my work', id); await settle(h.tasks)
  expect((await h.service.history(alice))[0].status).toBe('complete')
  expect([...h.values.keys()].filter((key) => key.startsWith('activity-archive:'))).toHaveLength(1)
  failing = false
  h.restart().wake(); await settle(h.tasks)
  expect(archived).toHaveLength(1)
  expect(archived[0]).toMatchObject({ userId: 'alice', job: { id, status: 'complete', source: 'manual', reply: 'Private response' } })
  expect(archived[0].job.startedAt).toBeDefined(); expect(archived[0].job.finishedAt).toBeDefined()
  expect([...h.values.keys()].filter((key) => key.startsWith('activity-archive:'))).toHaveLength(0)
})

test('archive history imports only the requested owner and preserves scheduled provenance and cancellation', async () => {
  const gate = deferred(), archived: { userId: string; job: PrivateAgentJob }[] = []
  const h = harness({ gate: gate.promise, archive: async (identity, job) => { archived.push({ userId: identity.userId, job: structuredClone(job) }) } })
  await h.invoke(bob, 'Bob private request'); await waitFor(() => h.calls.length === 1)
  const id = crypto.randomUUID()
  await h.service.invoke({ ...alice, sessionId: '', scheduledDeliveryId: id }, { requestId: id, agentId: profile.id, instruction: 'Scheduled' }, true)
  await h.service.cancel(alice, id)
  gate.resolve(); await settle(h.tasks)
  expect(archived.findLast((entry) => entry.job.id === id)).toMatchObject({ userId: 'alice', job: { source: 'scheduled', status: 'failed', errorCode: 'RUN_CANCELLED' } })
  archived.length = 0
  expect(await h.service.archiveHistory(alice)).toBe(true)
  expect(archived).toHaveLength(1)
  expect(archived[0].userId).toBe('alice')
  expect(archived[0].job.finishedAt).toBeDefined()
  expect(JSON.stringify(archived)).not.toContain('Bob private request')
})

test('history import cannot replace a newer job or pending archive snapshot', async () => {
  const h = harness({ archive: async () => { throw new Error('offline') } })
  await h.invoke(); await settle(h.tasks)
  const completed = (await h.service.history(alice))[0]
  h.service.history = async () => [{ ...completed, status: 'queued', revision: 0, reply: '' }]
  expect(await h.service.archiveHistory(alice)).toBe(false)
  expect((await h.restart().history(alice))[0]).toMatchObject({ status: 'complete', revision: completed.revision })
  const pending = [...h.values.entries()].find(([key]) => key.startsWith('activity-archive:'))?.[1]
  expect(pending).toMatchObject({ job: { status: 'complete', revision: completed.revision } })
})

test('a slow archive database does not block execution or completion', async () => {
  const gate = deferred(), h = harness({ archive: async () => { await gate.promise } })
  await h.invoke()
  await waitFor(() => h.events.some(({ event }) => event.type === 'agent.update' && event.job.status === 'complete'))
  expect((await h.service.history(alice))[0]).toMatchObject({ status: 'complete', reply: 'Private response' })
  gate.resolve(); await settle(h.tasks)
  expect([...h.values.keys()].filter((key) => key.startsWith('activity-archive:'))).toHaveLength(0)
})

test('the activity archive outlives rolling room chat history', async () => {
  const archived = new Map<string, PrivateAgentJob>()
  const h = harness({ archive: async (_identity, job) => { archived.set(job.id, structuredClone(job)) } })
  let first = ''
  for (let index = 0; index < 55; index++) {
    const id = crypto.randomUUID(); if (!index) first = id
    await h.invoke(alice, `Request ${index}`, id); await settle(h.tasks)
  }
  const history = await h.service.history(alice)
  expect(history).toHaveLength(50)
  expect(history.some((job) => job.id === first)).toBe(false)
  expect(archived.size).toBe(55)
  expect(archived.get(first)).toMatchObject({ status: 'complete', instruction: 'Request 0' })
})


test('concurrent history imports schedule and finish entries beyond the archive batch limit', async () => {
  const archived = new Map<string, PrivateAgentJob>()
  const h = harness({ archive: async (identity, job) => { archived.set(`${identity.userId}:${job.id}`, structuredClone(job)) } })
  for (const identity of [alice, bob]) {
    const ids = Array.from({ length: 50 }, () => crypto.randomUUID())
    h.values.set(`private-agent:${identity.userId}:index`, ids)
    for (const id of ids) h.values.set(`private-agent:${identity.userId}:job:${id}`, {
      id, agentId: profile.id, agentName: profile.name, instruction: `${identity.userId} private request`, reply: 'Saved',
      status: 'complete', revision: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } satisfies PrivateAgentJob)
  }
  expect(await Promise.all([h.service.archiveHistory(alice), h.service.archiveHistory(bob)])).toEqual([true, true])
  expect(archived.size).toBe(50)
  expect([...h.values.keys()].filter((key) => key.startsWith('activity-archive:'))).toHaveLength(50)
  expect(h.alarms.some((alarm) => alarm > Date.now())).toBe(true)
  // Simulate the scheduled alarm on a newly created coordinator, without a new
  // invocation, another import, or any connected room chat sockets.
  h.restart().wake(); await settle(h.tasks)
  expect(archived.size).toBe(100)
  expect([...h.values.keys()].filter((key) => key.startsWith('activity-archive:'))).toHaveLength(0)
})


test('typed timeouts preserve committed changes and expose a fixed public message', async () => {
  const h = harness({ fail: new AgentRunError('RUN_TIMEOUT'), commitBeforeFailure: true })
  await h.invoke(); await Promise.all(h.tasks)
  const job = (await h.service.history(alice))[0]
  expect(job.errorCode).toBe('RUN_TIMEOUT')
  expect(job.error).toBe('The agent ran out of time. 1 edit batch was saved. Continue to finish the remaining sections.')
  expect(job.commits).toEqual([{ documentId: 'doc', versionId: 'v2', versionNumber: 2 }])
})

test('retry includes the original instruction and saved receipts from a failed run', async () => {
  const h = harness({ fail: new AgentRunError('RUN_TIMEOUT'), commitBeforeFailure: true })
  await h.invoke(alice, 'Create a worksheet'); await Promise.all(h.tasks)
  await h.invoke(alice, 'Continue'); await Promise.all(h.tasks)
  expect(h.calls[1][0]).toEqual({ role: 'user', content: 'Create a worksheet' })
  expect(h.calls[1][1].content).toContain('v2')
  expect(h.calls[1].at(-1)).toEqual({ role: 'user', content: 'Continue' })
})
