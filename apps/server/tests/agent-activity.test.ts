import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { agentActivity, activityQuery, activityScope, activityStatus, archiveAgentRun } from '../src/agent-activity'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'
import type { ActivityPage } from '../../../shared/agent-activity'
import type { PrivateAgentJob } from '../../../shared/room-chat'

function harness() {
  const queries: { operation: string; query: unknown }[] = []
  let rows: Record<string, unknown>[] = []
  const db = {
    agentActivityRun: {
      findMany: async (query: { distinct?: string[]; where: { status?: unknown } }) => { queries.push({ operation: 'list', query }); return query.distinct || query.where.status ? [] : rows },
      findFirst: async (query: unknown) => { queries.push({ operation: 'detail', query }); return null },
    },
    room: { findMany: async (query: unknown) => { queries.push({ operation: 'rooms', query }); return [] } },
  } as unknown as Database
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('organizationId', 'org'); c.set('db', db)
    c.set('session', { user: { id: 'alice' }, session: { id: 'alice-session' } } as AppEnv['Variables']['session'])
    await next()
  })
  app.route('/activity', agentActivity)
  return { app, queries, setRows: (value: typeof rows) => { rows = value } }
}

test('activity rejects injected ownership and invalid filters', async () => {
  for (const query of [{ userId: 'bob' }, { status: 'secret' }, { from: 'yesterday' }, { from: '2026-11-18T00:00:00Z', to: '2026-11-17T00:00:00Z' }]) expect(activityQuery.safeParse(query).success).toBe(false)
  const h = harness()
  expect((await h.app.request('/activity?userId=bob')).status).toBe(400)
  expect((await h.app.request('/activity?cursor=invalid')).status).toBe(400)
  expect(h.queries).toHaveLength(0)
})

test('every timeline query and detail lookup is scoped to the owner and live room membership', async () => {
  const h = harness()
  const response = await h.app.request('/activity?agentId=scout&roomId=room&status=complete')
  expect(response.status).toBe(200)
  const queries = h.queries.filter((q) => q.operation === 'list')
  expect(queries).toHaveLength(3)
  for (const { query } of queries) expect(query).toMatchObject({ where: activityScope('org', 'alice') })
  expect(queries[0].query).toMatchObject({ where: { roomId: 'room', agentId: 'scout', status: 'complete' } })
  const missing = await h.app.request('/activity/other-room/private-id')
  expect(missing.status).toBe(404)
  expect(h.queries.at(-1)?.query).toMatchObject({ where: { ...activityScope('org', 'alice'), roomId: 'other-room', id: 'private-id' } })
})

test('keyset pagination handles matching timestamps and run IDs in different rooms', async () => {
  const h = harness(), createdAt = new Date('2026-11-17T00:00:00Z')
  h.setRows(Array.from({ length: 31 }, (_, index) => ({ id: 'same-id', roomId: `room-${31 - index}`, room: { name: 'Room' }, agentId: 'agent', agentName: 'Scout', title: 'Request', status: 'complete', source: 'manual', createdAt, updatedAt: createdAt, startedAt: null, finishedAt: null, commits: [], taskCommits: [], activities: [] })))
  const page = await (await h.app.request('/activity')).json() as ActivityPage
  expect(page.runs).toHaveLength(30)
  expect(page.runs[0]).not.toHaveProperty('instruction'); expect(page.runs[0]).not.toHaveProperty('reply')
  await h.app.request(`/activity?${new URLSearchParams({ cursor: page.nextCursor! })}`)
  expect(h.queries.filter((q) => q.operation === 'list')[3].query).toMatchObject({ where: { OR: [
    { createdAt: { lt: createdAt } }, { createdAt, id: { lt: 'same-id' } }, { createdAt, id: 'same-id', roomId: { lt: 'room-2' } },
  ] } })
})

test('archive uses monotonic replay-safe upserts and separates cancellation from failure', async () => {
  let statement = '', values: unknown[] = []
  const db = { $executeRaw: async (strings: TemplateStringsArray, ...args: unknown[]) => { statement = strings.join('?'); values = args; return 1 } } as unknown as Database
  const job: PrivateAgentJob = { id: 'run', agentId: 'agent', agentName: 'Scout', instruction: 'Private request', reply: 'Saved', status: 'failed', error: 'Cancelled. Any saved changes are preserved.', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:01:00Z', revision: 5, source: 'scheduled' }
  expect(activityStatus(job)).toBe('cancelled')
  expect(activityStatus({ ...job, error: 'Provider failed' })).toBe('failed')
  await archiveAgentRun(db, { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'session' }, job)
  expect(statement).toContain('ON CONFLICT ("organizationId", "roomId", "userId", id)')
  expect(statement).toContain('WHERE "agentActivityRun".revision < EXCLUDED.revision')
  expect(values.slice(0, 4)).toEqual(['org', 'room', 'alice', 'run'])
  expect(values).toContain('scheduled'); expect(values).toContain('cancelled')
})
