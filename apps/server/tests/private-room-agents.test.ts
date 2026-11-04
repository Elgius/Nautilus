import { expect, test } from 'bun:test'
import { PrivateRoomAgents, type PrivateAgentMessage } from '../src/private-room-agents'
import type { ChatIdentity } from '../src/room-chat-service'
import type { PrivateAgentEvent } from '../../../shared/room-chat'

const alice: ChatIdentity = { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'alice-session' }
const bob = { ...alice, userId: 'bob', sessionId: 'bob-session' }
const profile = { id: 'scout', name: 'Scout', role: 'Research', rules: ['Cite sources'] }
function harness(options: { denyAgent?: boolean; fail?: boolean } = {}) {
  const values = new Map<string, unknown>()
  const store = {
    get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)) },
    delete: async (key: string) => values.delete(key),
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback(store),
  }
  const events: { userId: string; event: PrivateAgentEvent }[] = []
  const tasks: Promise<void>[] = []
  const calls: PrivateAgentMessage[][] = []
  let allowed = true
  const service = new PrivateRoomAgents({
    storage: store as unknown as DurableObjectStorage,
    canAccess: async () => allowed,
    profile: async (identity, id) => !options.denyAgent && identity.organizationId === 'org' && id === profile.id ? profile : null,
    stream: async function* (_profile, messages) {
      calls.push(messages)
      if (options.fail) throw new Error('PROVIDER_SECRET_AND_PROMPT')
      yield 'Private response'
    },
    send: async (identity, event) => { if (allowed) events.push({ userId: identity.userId, event: structuredClone(event) }) },
    waitUntil: (task) => { tasks.push(task) },
  })
  const invoke = (identity = alice, instruction = 'Alice secret', id = crypto.randomUUID()) => service.invoke(identity, { requestId: id, agentId: profile.id, instruction, userId: 'attacker' })
  return { service, invoke, values, events, calls, tasks, revoke: () => { allowed = false } }
}

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
