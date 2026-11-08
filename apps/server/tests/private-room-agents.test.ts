import { expect, test } from 'bun:test'
import { PrivateRoomAgents, type PrivateAgentMessage } from '../src/private-room-agents'
import type { ChatIdentity } from '../src/room-chat-service'
import type { PrivateAgentEvent } from '../../../shared/room-chat'

const alice: ChatIdentity = { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'alice-session' }
const bob = { ...alice, userId: 'bob', sessionId: 'bob-session' }
const profile = { id: 'scout', name: 'Scout', role: 'Research', rules: ['Cite sources'] }
function harness(options: { denyAgent?: boolean; fail?: boolean; gate?: Promise<void>; reply?: string; preview?: string } = {}) {
  const values = new Map<string, unknown>()
  let transactions: Promise<unknown> = Promise.resolve()
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
          list: async ({ prefix }: { prefix: string }) => new Map([...local].filter(([key]) => key.startsWith(prefix))),
          setAlarm: async () => {},
        }
        const result = await callback(tx)
        for (const key of changed) { if (local.has(key)) values.set(key, local.get(key)); else values.delete(key) }
        return result
      })
      transactions = task.catch(() => {})
      return task
    },
    setAlarm: async () => {},
    list: async ({ prefix }: { prefix: string }) => new Map([...values].filter(([key]) => key.startsWith(prefix))),
  }
  const events: { userId: string; event: PrivateAgentEvent }[] = []
  const tasks: Promise<void>[] = []
  const calls: PrivateAgentMessage[][] = []
  let allowed = true
  const deps: ConstructorParameters<typeof PrivateRoomAgents>[0] = {
    storage: store as unknown as DurableObjectStorage,
    canAccess: async () => allowed,
    acquire: async () => true,
    release: async () => {},
    profile: async (identity, id) => !options.denyAgent && identity.organizationId === 'org' && id === profile.id ? profile : null,
    stream: async function* (_profile, messages, signal, _identity, run) {
      calls.push(messages)
      if (calls.length === 1) await options.gate
      signal.throwIfAborted()
      if (options.preview) await run.preview?.('write', options.preview)
      if (options.fail) throw new Error('PROVIDER_SECRET_AND_PROMPT')
      yield options.reply ?? 'Private response'
    },
    send: async (identity, event) => { if (allowed) events.push({ userId: identity.userId, event: structuredClone(event) }) },
    waitUntil: (task) => { tasks.push(task) },
  }
  const service = new PrivateRoomAgents(deps)
  const invoke = (identity = alice, instruction = 'Alice secret', id = crypto.randomUUID()) => service.invoke(identity, { requestId: id, agentId: profile.id, instruction, userId: 'attacker' })
  return { service, invoke, values, events, calls, tasks, restart: () => new PrivateRoomAgents(deps), revoke: () => { allowed = false } }
}

test('document previews are ephemeral and sent only through the requesting user’s private channel', async () => {
  const h = harness({ preview: 'PRIVATE_UNREVIEWED_DOCUMENT_TEXT' })
  await h.invoke(alice); await Promise.all(h.tasks)
  const previews = h.events.filter(({ event }) => event.type === 'agent.document-preview')
  expect(previews).toHaveLength(1)
  expect(previews[0]).toMatchObject({ userId: 'alice', event: { type: 'agent.document-preview', toolCallId: 'write', input: 'PRIVATE_UNREVIEWED_DOCUMENT_TEXT' } })
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
  await expect(h.invoke()).rejects.toThrow('Invalid agent selection')
  expect(h.calls).toHaveLength(0); expect(h.values.size).toBe(0)
  await expect(h.service.invoke(alice, { requestId: 'invalid', agentId: 'scout', instruction: 'secret' })).rejects.toThrow('Invalid message ID')
  await expect(h.invoke(alice, ' '.repeat(10))).rejects.toThrow('Enter a message')
})

test('model failures are private, sanitized, persisted and safely retryable with a new ID', async () => {
  const h = harness({ fail: true })
  await h.invoke(); await Promise.all(h.tasks)
  const [job] = await h.service.history(alice)
  expect(job.status).toBe('failed')
  expect(job.error).toBe('The agent could not complete this response. Please retry.')
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
  expect((await h.service.history(bob))[0]).toMatchObject({ status: 'failed', error: 'Cancelled before starting.' })
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
