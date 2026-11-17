import { expect, test } from 'bun:test'
import { PrivateRoomAgents, type PrivateAgentMessage, type AgentRunContext } from '../src/private-room-agents'
import type { ChatIdentity } from '../src/room-chat-service'
import type { HubSource, AgentRunMode, PrivateAgentJob, PrivateAgentEvent } from '../../../shared/room-chat'
import { scheduleRoomAlarm } from '../src/room-alarm'

const alice: ChatIdentity = { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'alice-session' }
const bob = { ...alice, userId: 'bob', sessionId: 'bob-session' }
const profile = { id: 'scout', name: 'Scout', role: 'Research', rules: ['Cite sources'] }
function harness(options: { archive?: (identity: ChatIdentity, job: PrivateAgentJob) => Promise<void>; denyAgent?: boolean; fail?: boolean; gate?: Promise<void>; reply?: string; preview?: string; onRun?: (run: AgentRunContext, signal: AbortSignal) => Promise<void>; onEvent?: (event: PrivateAgentEvent) => void; filterHistory?: ConstructorParameters<typeof PrivateRoomAgents>[0]['filterHistory'] } = {}) {
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
    filterHistory: options.filterHistory,
    archive: options.archive,
    canAccess: async () => allowed,
    acquire: async () => true,
    release: async () => {},
    profile: async (identity, id) => !options.denyAgent && identity.organizationId === 'org' && id === profile.id ? profile : null,
    stream: async function* (_profile, messages, signal, _identity, run) {
      calls.push(messages)
      await options.onRun?.(run, signal)
      if (calls.length === 1) await options.gate
      signal.throwIfAborted()
      if (options.preview) await run.preview?.('write', options.preview)
      if (options.fail) throw new Error('PROVIDER_SECRET_AND_PROMPT')
      yield options.reply ?? 'Private response'
    },
    send: async (identity, event) => { if (allowed) events.push({ userId: identity.userId, scheduledDeliveryId: identity.scheduledDeliveryId, event: structuredClone(event) }); options.onEvent?.(event) },
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
  expect((await h.service.history(bob))[0]).toMatchObject({ status: 'failed', error: 'Cancelled before starting.' })
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
    event: { type: 'agent.update', job: { id, status: 'failed', error: 'Cancelled before starting.' } } })
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


test('Hub conversations and knowledge scopes cannot inherit another conversation context', async () => {
  const h = harness(), one = crypto.randomUUID(), two = crypto.randomUUID()
  const invoke = async (conversationId: string, knowledge: string[], instruction: string) => {
    await h.service.invoke(alice, { requestId: crypto.randomUUID(), agentId: profile.id, conversationId, knowledge, instruction }); await Promise.all(h.tasks)
  }
  await invoke(one, ['PERSONAL'], 'Private reference')
  await invoke(two, ['ORGANIZATION'], 'New chat')
  await invoke(one, ['ORGANIZATION'], 'Shared request')
  expect(h.calls[1]).toEqual([{ role: 'user', content: 'New chat' }])
  expect(h.calls[2]).toEqual([{ role: 'user', content: 'Shared request' }])
  await invoke(one, ['PERSONAL'], 'Follow up privately')
  expect(h.calls[3][0].content).toBe('Private reference')
})

test('tool cards persist without raw arguments and confirmation is owner-scoped', async () => {
  const pending = Promise.withResolvers<{ jobId: string; confirmationId: string }>()
  let approved = false
  const h = harness({
    onRun: async (run) => {
      await run.tool?.({ id: 'delete', name: 'deleteTask', status: 'running' })
      approved = await run.confirm!('Delete task?')
      await run.tool?.({ id: 'delete', name: 'deleteTask', status: 'complete' })
    },
    onEvent: (event) => {
      if (event.type === 'agent.update' && event.job.confirmations?.[0]?.status === 'pending') pending.resolve({ jobId: event.job.id, confirmationId: event.job.confirmations[0].id })
    },
  })
  await h.invoke()
  const { jobId, confirmationId } = await pending.promise
  await expect(h.service.confirm(bob, jobId, confirmationId, true)).rejects.toThrow('no longer available')
  await h.service.confirm(alice, jobId, confirmationId, true)
  await Promise.all(h.tasks)
  expect(approved).toBe(true)
  const saved = (await h.service.history(alice))[0]
  expect(saved.tools).toEqual([{ id: 'delete', name: 'deleteTask', status: 'complete' }])
  expect(saved.confirmations?.[0].status).toBe('approved')
  await expect(h.service.confirm(alice, jobId, confirmationId, true)).rejects.toThrow('no longer available')
})

test('cancelling during confirmation declines it and releases the room queue', async () => {
  const pending = Promise.withResolvers<string>()
  let approved = true
  const h = harness({ onRun: async (run) => { approved = await run.confirm!('Delete task?') }, onEvent: (event) => {
    if (event.type === 'agent.update' && event.job.confirmations?.[0]?.status === 'pending') pending.resolve(event.job.id)
  } })
  await h.invoke()
  await h.service.cancel(alice, await pending.promise)
  await Promise.all(h.tasks)
  expect(approved).toBe(false)
  expect((await h.service.history(alice))[0].status).toBe('failed')
})

test('citation records are included in streamed job JSON and survive history replay', async () => {
  const source = { id: 'plan', title: 'Launch plan', scope: 'ORGANIZATION' as const, body: 'Approved', roomId: 'room', documentId: 'doc', messageId: null, updatedAt: '',
    citations: [{ quote: 'Launch approved.', locator: 'Document body', documentVersionId: 'v1' }] }
  const h = harness({ reply: 'Launch is approved [Plan](#source-plan). [Fake](#source-unknown)', onRun: async (run) => { await run.sources?.([source]) } })
  await h.invoke(); await Promise.all(h.tasks)
  const job = (await h.service.history(alice))[0]
  expect(job.citations).toMatchObject([{ sourceId: 'plan', number: 1, quote: 'Launch approved.', documentVersionId: 'v1' }])
  const event = h.events.filter(({ event }) => event.type === 'agent.update').at(-1)!.event
  expect(event).toMatchObject({ type: 'agent.update', job: { citations: job.citations } })
  expect(JSON.parse(JSON.stringify(job)).citations).toEqual(job.citations)
  expect((await h.restart().history(alice))[0].citations).toEqual(job.citations)
})


const knowledgeSource: HubSource = { id: 'knowledge-source', title: 'Plan', revision: 1, scope: 'ORGANIZATION', body: 'TEAM_SECRET', roomId: 'room', documentId: 'doc', messageId: null, updatedAt: '', citations: [{ quote: 'TEAM_SECRET', locator: 'Body', documentVersionId: 'v1' }] }
function withdrawnHistory(jobs: PrivateAgentJob[]) {
  return jobs.map((job) => job.knowledgeReferences?.some((ref) => ref.id === knowledgeSource.id) ? { ...job, sources: [], citations: [], knowledgeUnavailable: true, reply: 'Knowledge is no longer available.' } : job)
}

test('sourced answers and dependencies outlive rolling history without destructive import redaction', async () => {
  const archived = new Map<string, PrivateAgentJob>()
  let withdrawn = false
  const h = harness({ reply: 'TEAM_SECRET [Plan](#source-knowledge-source)',
    archive: async (_identity, job) => { archived.set(job.id, structuredClone(job)) },
    filterHistory: async (_identity, jobs) => withdrawn ? withdrawnHistory(jobs) : jobs,
    onRun: async (run) => { await run.sources?.([knowledgeSource]) },
  })
  await h.invoke(); await settle(h.tasks)
  const job = (await h.service.history(alice))[0]
  expect(job.reply).toContain('TEAM_SECRET')
  withdrawn = true
  expect((await h.service.history(alice))[0].reply).not.toContain('TEAM_SECRET')
  await h.service.archiveHistory(alice)
  expect(archived.get(job.id)).toMatchObject({ reply: job.reply, sources: job.sources, knowledgeReferences: job.knowledgeReferences })
  for (let index = 0; index < 50; index++) { await h.invoke(alice, `Later question ${index}`); await settle(h.tasks) }
  expect((await h.service.history(alice)).some((entry) => entry.id === job.id)).toBe(false)
  expect(archived.get(job.id)).toMatchObject({ status: 'complete', reply: job.reply, sources: job.sources, knowledgeReferences: job.knowledgeReferences })
})

test('withdrawing knowledge filters every live update and stops the active run', async () => {
  let withdrawn = false
  const afterWithdrawal: PrivateAgentEvent[] = []
  const h = harness({ reply: 'TEAM_SECRET [Plan](#source-knowledge-source)',
    filterHistory: async (_identity, jobs) => withdrawn ? withdrawnHistory(jobs) : jobs,
    onRun: async (run) => { await run.sources?.([knowledgeSource]); withdrawn = true },
    onEvent: (event) => { if (withdrawn) afterWithdrawal.push(structuredClone(event)) },
  })
  await h.invoke(); await Promise.all(h.tasks)
  expect(afterWithdrawal.length).toBeGreaterThan(0)
  expect(JSON.stringify(afterWithdrawal)).not.toContain('TEAM_SECRET')
  expect(afterWithdrawal.at(-1)).toMatchObject({ type: 'agent.update', job: { status: 'failed', knowledgeUnavailable: true, citations: [] } })
  expect((await h.service.history(alice))[0].reply).not.toContain('TEAM_SECRET')
})

test('knowledge authorization outages never fall back to sending an unfiltered response', async () => {
  let outage = false
  const sent: PrivateAgentEvent[] = []
  const h = harness({ reply: 'TEAM_SECRET', onRun: async (run) => { await run.sources?.([knowledgeSource]); outage = true },
    filterHistory: async (_identity, jobs) => { if (outage) throw new Error('database unavailable'); return jobs },
    onEvent: (event) => { if (outage) sent.push(event) },
  })
  await h.invoke(); await Promise.all(h.tasks)
  expect(sent).toEqual([])
})

test('follow-ups inherit source dependencies even without new retrieval and after parent history is pruned', async () => {
  let withdrawn = false, turns = 0
  const h = harness({ reply: 'TEAM_SECRET [Plan](#source-knowledge-source)',
    filterHistory: async (_identity, jobs) => withdrawn ? withdrawnHistory(jobs) : jobs,
    onRun: async (run) => { if (++turns === 1) await run.sources?.([knowledgeSource]) },
  })
  await h.invoke(alice, 'Original question'); await Promise.all(h.tasks)
  await h.invoke(alice, 'Restate your answer'); await Promise.all(h.tasks)
  const before = await h.service.history(alice)
  expect(before[1].knowledgeReferences).toEqual([{ id: knowledgeSource.id, revision: 1 }])
  expect(before[1].citations?.[0].sourceId).toBe(knowledgeSource.id)
  expect(h.calls[1].some((message) => message.role === 'assistant' && message.content.includes('TEAM_SECRET'))).toBe(true)
  h.values.delete(`private-agent:alice:job:${before[0].id}`)
  withdrawn = true
  expect(JSON.stringify(await h.restart().history(alice))).not.toContain('TEAM_SECRET')
  await h.invoke(alice, 'A new question'); await Promise.all(h.tasks)
  expect(h.calls[2]).toEqual([{ role: 'user', content: 'A new question' }])
})

test('answers citing more than ten documents retain all evidence through persistence and replay', async () => {
  const sources = Array.from({ length: 12 }, (_, index) => ({ ...knowledgeSource, id: `document-${index}`, kind: 'document' as const, scope: 'ROOM' as const }))
  const reply = sources.map((source) => `[Document](#source-${source.id})`).join(' ')
  const h = harness({ reply, onRun: async (run) => { await run.sources?.(sources) } })
  await h.invoke(); await Promise.all(h.tasks)
  const job = (await h.restart().history(alice))[0]
  expect(job.status).toBe('complete')
  expect(job.sources).toHaveLength(12)
  expect(job.citations).toHaveLength(12)
  expect(job.citations?.[0].sourceId).toBe(sources[0].id)
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
  expect(archived.findLast((entry) => entry.job.id === id)).toMatchObject({ userId: 'alice', job: { source: 'scheduled', status: 'failed', error: 'Cancelled before starting.' } })
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
