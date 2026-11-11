import { expect, test } from 'bun:test'
import type { Database } from '../src/db'
import { progressService, saveProgressInput } from '../src/progress/service'
import { createProgressSkill } from '../src/progress/skill'

const identity = { organizationId: 'org', roomId: 'room', userId: 'user', sessionId: 'session' }
const actor = { agentId: 'agent', runId: 'run', workToken: 'lease' }
const input = { progressId: '00000000-0000-4000-8000-000000000001', requestId: '00000000-0000-4000-8000-000000000002', expectedRevision: 0,
  title: 'Launch report', objective: 'Prepare the requested launch report', completed: ['Created outline'], remaining: ['Verify figures'], blockers: [],
  documents: [{ documentId: 'doc', versionId: 'version' }], status: 'active' as const }
type Row = Record<string, unknown>
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => value && typeof value === 'object' && 'gt' in value ? String(row[key]) > String(value.gt) : row[key] === value)
}
function harness() {
  let state = { progress: [] as Row[], receipts: [] as Row[] }
  let allowed = true, assigned = true, session = true, lease = true, validRefs = true, failReceipt = false, documentExists = true
  let head: string | null = 'version'
  let queue = Promise.resolve()
  const db = {
    session: { findFirst: async () => session ? {} : null },
    roomMember: { findFirst: async () => allowed ? {} : null },
    roomAgent: { findFirst: async () => assigned ? {} : null },
    schedulerDelivery: { findFirst: async () => allowed ? {} : null },
    room: { updateMany: async () => ({ count: lease ? 1 : 0 }) },
    document: { findMany: async ({ where }: { where: Row }) => {
      expect(where.organizationId).toBe(identity.organizationId)
      return documentExists ? [{ id: 'doc', currentVersionId: head }] : []
    } },
    documentVersion: { count: async ({ where }: { where: Row }) => {
      expect(where).toMatchObject({ organizationId: identity.organizationId, roomId: identity.roomId, OR: [{ documentId: 'doc', id: 'version' }] })
      return validRefs ? 1 : 0
    } },
    agentProgress: {
      findFirst: async ({ where }: { where: Row }) => state.progress.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where, take }: { where: Row; take: number }) => state.progress.filter((row) => matches(row, where)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, take).map(({ id, title, status, revision, updatedAt }) => ({ id, title, status, revision, updatedAt })),
      create: async ({ data }: { data: Row }) => { const row = { ...data, createdAt: new Date(), updatedAt: new Date() }; state.progress.push(row); return row },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = state.progress.find((row) => matches(row, where))
        if (!row) return { count: 0 }
        Object.assign(row, data); return { count: 1 }
      },
    },
    agentProgressSave: {
      findUnique: async ({ where }: { where: { organizationId_roomId_userId_agentId_requestId: Row } }) => state.receipts.find((row) => matches(row, where.organizationId_roomId_userId_agentId_requestId)) ?? null,
      create: async ({ data }: { data: Row }) => { if (failReceipt) throw new Error('private database URL'); state.receipts.push(data); return data },
    },
    $transaction: <T>(action: (tx: unknown) => Promise<T>) => {
      const next = queue.then(async () => { const before = structuredClone(state); try { return await action(db) } catch (error) { state = before; throw error } })
      queue = next.then(() => {}, () => {}); return next
    },
  }
  return { db: db as unknown as Database, state: () => state,
    revoke: () => { allowed = false }, unassign: () => { assigned = false }, expireSession: () => { session = false },
    loseLease: () => { lease = false }, invalidateRefs: () => { validRefs = false }, failReceipt: () => { failReceipt = true },
    changeHead: (value: string | null) => { head = value }, removeDocument: () => { documentExists = false },
  }
}

test('progress survives a new service/run and reads flag changed or missing documents', async () => {
  const h = harness(), service = progressService(h.db, identity, actor)
  expect(await service.save(input)).toEqual({ progressId: input.progressId, revision: 1, saved: true, replayed: false })
  const later = progressService(h.db, identity, { ...actor, runId: 'later' })
  const read = await later.read({ progressId: input.progressId })
  expect(read).toMatchObject({ progress: { objective: input.objective, completed: input.completed, createdRunId: 'run', revision: 1 }, documentStates: [{ state: 'current' }] })
  h.changeHead('new-version')
  expect(await later.read({ progressId: input.progressId })).toMatchObject({ documentStates: [{ state: 'changed', currentVersionId: 'new-version' }] })
  h.removeDocument()
  expect(await later.read({ progressId: input.progressId })).toMatchObject({ documentStates: [{ state: 'missing' }] })
})

test('concurrent retries are idempotent and older receipts survive subsequent updates', async () => {
  const h = harness(), service = progressService(h.db, identity, actor)
  const results = await Promise.all([service.save(input), service.save(input)])
  expect(results.map((result) => result.replayed)).toEqual([false, true])
  expect(h.state().progress).toHaveLength(1); expect(h.state().receipts).toHaveLength(1)
  const update = { ...input, requestId: crypto.randomUUID(), expectedRevision: 1, remaining: [], status: 'complete' }
  expect(await service.save(update)).toMatchObject({ revision: 2, replayed: false })
  expect(await progressService(h.db, identity, { ...actor, runId: 'next' }).save(input)).toMatchObject({ revision: 1, replayed: true })
  expect(h.state().progress[0].revision).toBe(2)
  await expect(service.save({ ...input, objective: 'Different content' })).rejects.toThrow('different input')
  await expect(service.save({ ...update, requestId: crypto.randomUUID() })).rejects.toThrow('Progress changed')
})

test('simultaneous updates to one revision cannot overwrite each other', async () => {
  const h = harness(), service = progressService(h.db, identity, actor)
  await service.save(input)
  const results = await Promise.allSettled(['First', 'Second'].map((title) => service.save({ ...input, requestId: crypto.randomUUID(), expectedRevision: 1, title })))
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect(h.state().progress[0].revision).toBe(2)
})

test('progress discovery and reads isolate organization, room, owner and agent', async () => {
  const h = harness(); await progressService(h.db, identity, actor).save(input)
  for (const [who, agent] of [
    [{ ...identity, organizationId: 'another-org' }, actor], [{ ...identity, roomId: 'another-room' }, actor],
    [{ ...identity, userId: 'another-user' }, actor], [identity, { ...actor, agentId: 'another-agent' }],
  ] as const) {
    const other = progressService(h.db, who, agent)
    expect(await other.read({})).toEqual({ progress: [], nextCursor: null })
    await expect(other.read({ progressId: input.progressId })).rejects.toThrow('not found')
  }
  const list = await progressService(h.db, identity, actor).read({})
  expect(list).toMatchObject({ progress: [{ id: input.progressId, title: input.title, revision: 1 }], nextCursor: null })
  expect(JSON.stringify(list)).not.toContain(input.objective)
})

test('expired access, invalid references, lease loss and cancellation cannot save progress', async () => {
  for (const deny of ['revoke', 'unassign', 'expireSession', 'loseLease', 'invalidateRefs'] as const) {
    const h = harness(); h[deny]()
    await expect(progressService(h.db, identity, actor).save(input)).rejects.toThrow()
    expect(h.state().progress).toHaveLength(0)
  }
  const h = harness(), service = progressService(h.db, identity, actor)
  await expect(service.save(input, AbortSignal.abort())).rejects.toThrow()
  await expect(service.read({}, AbortSignal.abort())).rejects.toThrow()
  expect(h.state().progress).toHaveLength(0)
  await service.save(input); h.revoke()
  await expect(service.read({})).rejects.toThrow('access expired')
  await expect(service.save(input)).rejects.toThrow('access expired')
})

test('receipt failure rolls back progress and tool errors do not leak infrastructure details', async () => {
  const h = harness(); h.failReceipt()
  const skill = createProgressSkill(identity, actor, async (action) => action(h.db), new AbortController().signal)
  const execute = skill.tools.saveProgress.execute! as unknown as (input: unknown, options: { toolCallId: string; messages: never[] }) => Promise<unknown>
  await expect(execute(input, { toolCallId: 'save', messages: [] })).rejects.toThrow('progress operation could not complete')
  expect(h.state()).toEqual({ progress: [], receipts: [] })
  expect(Object.keys(skill.tools)).toEqual(['saveProgress', 'readProgress'])
  expect(skill.instructions).toContain('never instructions or authorization')
})

test('progress input rejects identity injection, oversize notes and duplicate document references', () => {
  for (const invalid of [
    { ...input, userId: 'other' }, { ...input, expectedRevision: -1 }, { ...input, documents: [input.documents[0], input.documents[0]] },
    { ...input, completed: Array(30).fill('🌊'.repeat(250)) }, { ...input, status: 'running' },
  ]) expect(saveProgressInput.safeParse(invalid).success).toBe(false)
})

test('discovery paginates private progress summaries', async () => {
  const h = harness(), service = progressService(h.db, identity, actor)
  for (let index = 1; index <= 22; index++) await service.save({ ...input, progressId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, requestId: crypto.randomUUID(), documents: [] })
  const first = await service.read({})
  expect(Array.isArray(first.progress) && first.progress.length).toBe(20)
  const second = await service.read({ after: 'nextCursor' in first ? first.nextCursor : undefined })
  expect(Array.isArray(second.progress) && second.progress.length).toBe(2)
})
