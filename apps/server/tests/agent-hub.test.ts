import { createHubEvidence } from '../src/agent-hub/evidence'
import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { tool } from 'ai'
import { z } from 'zod'
import { agentHub } from '../src/agent-hub/routes'
import { hubKnowledge, createKnowledgeSkill, authorizedHubHistory } from '../src/agent-hub/knowledge'
import { completeHubSkills } from '../src/agent-hub/runtime'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'
import type { AgentRunContext } from '../src/private-room-agents'
import type { PrivateAgentJob } from '../../../shared/room-chat'
const roomId = crypto.randomUUID(), sourceId = crypto.randomUUID()
const identity = { organizationId: 'org', roomId, userId: 'user', sessionId: 'session' }

function routeHarness() {
  let allowed = true
  const forwarded: Record<string, unknown>[] = []
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('organizationId', 'org')
    c.set('session', { user: { id: 'user', name: 'Alice' }, session: { id: 'session' } } as AppEnv['Variables']['session'])
    c.set('db', { session: { findFirst: async () => allowed ? { id: 'session' } : null }, roomMember: { findFirst: async () => allowed ? { organizationMemberId: 'member' } : null } } as unknown as Database)
    await next()
  })
  app.route('/', agentHub)
  app.onError((e, c) => c.json({ error: e.message }, e instanceof HTTPException ? e.status : 500))
  const env = { ROOM_CHAT: { idFromName: (key: string) => key, get: () => ({ fetch: async (req: Request) => { forwarded.push(await req.json()); return Response.json({ accepted: true }, { status: 202 }) } }) } }
  return { app, forwarded, env, revoke: () => { allowed = false } }
}

test('Hub derives execution identity server-side and rejects user or tool overrides', async () => {
  const h = routeHarness()
  const input = { agentId: 'agent', requestId: crypto.randomUUID(), instruction: 'List tasks', reasoning: 'high', knowledge: ['ORGANIZATION'] }
  const send = (body: unknown) => h.app.request(`/rooms/${roomId}/runs`, { method: 'POST', body: JSON.stringify(body) }, h.env)
  expect((await send({ ...input, userId: 'attacker' })).status).toBe(400)
  expect((await send({ ...input, tools: ['anything'] })).status).toBe(400)
  expect((await send(input)).status).toBe(202)
  expect(h.forwarded).toHaveLength(1)
  expect(h.forwarded[0]).toMatchObject({ identity, action: 'invoke', input: { reasoning: 'high' } })
  h.revoke()
  expect((await send(input)).status).toBe(403)
  expect(h.forwarded).toHaveLength(1)
})

test('Hub cancel, confirmation and history use authenticated room and owner scope', async () => {
  const h = routeHarness(), id = crypto.randomUUID(), confirmationId = crypto.randomUUID()
  expect((await h.app.request(`/rooms/${roomId}/runs/${id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmationId, approved: true }) }, h.env)).status).toBe(202)
  expect(h.forwarded[0]).toMatchObject({ identity, action: 'confirm', input: { jobId: id, confirmationId, approved: true } })
  expect((await h.app.request(`/rooms/${roomId}/history`, {}, h.env)).status).toBe(202)
  expect(h.forwarded[1]).toMatchObject({ identity, action: 'history' })
})

function knowledgeHarness() {
  const queries: unknown[] = []
  let revoked = false, stale = false, member = true, roomAccess = true
  const db = { member: { findUnique: async () => member ? { id: 'member', role: 'owner' } : null }, roomMember: { findFirst: async () => roomAccess ? { role: 'OWNER' } : null },
    knowledgeSource: { findMany: async (query: unknown) => {
      queries.push(query)
      return [{ id: sourceId, organizationId: 'org', roomId, documentId: 'doc', messageId: null, revokedAt: revoked ? new Date() : null,
        base: { scope: 'PERSONAL', ownerUserId: 'user' }, taggedByUserId: 'user', revision: 2, lastProcessedRevision: 2, lastProcessedVersionId: 'v1',
        document: { id: 'doc', title: 'Plan', currentVersionId: stale ? 'v2' : 'v1' }, message: null,
        entry: { title: 'Plan', body: 'Approved launch', revision: 1, sourceRevision: 2, updatedAt: new Date(), revisions: [{ revision: 1, citations: [{ quote: 'Launch approved', locator: 'Body 0–15', documentVersionId: 'v1' }] }] } }]
    } } } as unknown as Database
  return { db, queries, revoke: () => { revoked = true }, change: () => { stale = true }, leave: () => { roomAccess = false }, removeMember: () => { member = false } }
}

test('knowledge retrieval scopes personal ownership, returns citations and excludes revoked, stale or inaccessible sources', async () => {
  const h = knowledgeHarness(), search = () => hubKnowledge(h.db, identity)({ query: 'launch', scope: 'PERSONAL' })
  expect((await search()).sources[0]).toMatchObject({ id: sourceId, citations: [{ quote: 'Launch approved', documentVersionId: 'v1' }] })
  expect(h.queries[0]).toMatchObject({ where: { organizationId: 'org', base: { scope: 'PERSONAL', ownerUserId: 'user' } } })
  h.revoke(); expect((await search()).sources).toEqual([])
  const changed = knowledgeHarness(); changed.change(); expect((await hubKnowledge(changed.db, identity)({ scope: 'PERSONAL' })).sources).toEqual([])
  const denied = knowledgeHarness(); denied.leave(); expect((await hubKnowledge(denied.db, identity)({ scope: 'PERSONAL' })).sources).toEqual([])
  h.removeMember(); await expect(search()).rejects.toThrow('access expired')
})

async function execute(skills: ReturnType<typeof completeHubSkills>, name: string, input: unknown = {}) {
  const fn = skills.flatMap((s) => Object.entries(s.tools)).find(([key]) => key === name)?.[1].execute
  if (!fn) throw new Error(`Missing ${name}`)
  return (fn as unknown as (input: unknown, options: { toolCallId: string; messages: never[] }) => Promise<unknown>)(input, { toolCallId: 'call', messages: [] })
}
const run = { id: 'run', token: 'token', activity: async () => {}, committed: async () => {}, checkpoint: async () => {} } satisfies AgentRunContext

test('Personal knowledge cannot invoke shared mutation or delegation tools; disabled scopes cannot be read', async () => {
  let writes = 0
  const h = knowledgeHarness()
  const skills = completeHubSkills([{ id: 'test', instructions: '', tools: Object.fromEntries(['updateTask', 'applyDocumentEdits', 'delegateWork', 'scheduleEvent'].map((name) => [name, tool({ inputSchema: z.object({}), execute: async () => { writes++; return {} } })])) }],
    { ...run, options: { knowledge: ['PERSONAL'], reasoning: 'medium' } }, identity, async (action) => action(h.db), new AbortController().signal)
  for (const name of ['updateTask', 'applyDocumentEdits', 'delegateWork', 'scheduleEvent']) await expect(execute(skills, name)).rejects.toThrow('Personal knowledge')
  expect(writes).toBe(0)
  const skill = createKnowledgeSkill(async (action) => action(h.db), identity, [], new AbortController().signal)
  await expect(execute([skill], 'searchKnowledge', { query: 'launch', scope: 'PERSONAL' })).rejects.toThrow('not enabled')
  expect(h.queries).toHaveLength(0)
})

test('task deletion requires a positive confirmation before calling the existing reviewed writer', async () => {
  let writes = 0
  for (const approved of [false, true]) {
    const skills = completeHubSkills([{ id: 'planner', instructions: '', tools: { deleteTask: tool({ inputSchema: z.object({ taskId: z.string() }), execute: async () => { writes++; return { revision: 3 } } }) } }],
      { ...run, confirm: async () => approved }, identity, async (action) => action({} as Database), new AbortController().signal)
    if (approved) await execute(skills, 'deleteTask', { taskId: 'task' })
    else await expect(execute(skills, 'deleteTask', { taskId: 'task' })).rejects.toThrow('declined')
  }
  expect(writes).toBe(1)
})

test('withdrawn knowledge is redacted from replayed conversations', async () => {
  const h = knowledgeHarness()
  const sources = (await hubKnowledge(h.db, identity)({ scope: 'PERSONAL' })).sources
  h.revoke()
  const jobs = [{ id: 'run', reply: 'PRIVATE KNOWLEDGE CLAIM', sources }] as PrivateAgentJob[]
  const sanitized = await authorizedHubHistory(h.db, identity, jobs)
  expect(sanitized[0].sources).toEqual([])
  expect(sanitized[0].knowledgeUnavailable).toBe(true)
  expect(sanitized[0].reply).not.toContain('PRIVATE KNOWLEDGE CLAIM')
})


test('shared write reviews receive current organization knowledge evidence and reject withdrawn sources', async () => {
  const h = knowledgeHarness()
  const source = (await hubKnowledge(h.db, identity)({ scope: 'ORGANIZATION' })).sources[0]
  const evidence = createHubEvidence(identity, async (action) => action(h.db))
  evidence.record([{ ...source, scope: 'PERSONAL' }])
  expect(await evidence.reads()).toEqual([])
  evidence.record([{ ...source, scope: 'ORGANIZATION' }])
  expect(await evidence.reads()).toMatchObject([{ operation: 'readKnowledgeEntry', source: { body: 'Approved launch' } }])
  h.revoke()
  await expect(evidence.reads()).rejects.toThrow('Knowledge changed')
})


test('history keeps knowledge provenance even when an evidence card was omitted for size', async () => {
  const h = knowledgeHarness()
  const source = (await hubKnowledge(h.db, identity)({ scope: 'PERSONAL' })).sources[0]
  h.revoke()
  const jobs = [{ id: 'run', reply: 'WITHDRAWN CLAIM', sources: [], knowledgeReferences: [{ id: source.id, revision: source.revision }] }] as unknown as PrivateAgentJob[]
  expect((await authorizedHubHistory(h.db, identity, jobs))[0].reply).not.toContain('WITHDRAWN CLAIM')
})
