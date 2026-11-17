import { expect, test } from 'bun:test'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import { PrismaClient } from '../src/generated/prisma-tooling/client'
import { Hono } from 'hono'
import { agentActivity, archiveAgentRun } from '../src/agent-activity'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'
import type { PrivateAgentJob } from '../../../shared/room-chat'
import type { ActivityDetail, ActivityPage } from '../../../shared/agent-activity'

const connection = process.env.ACTIVITY_TEST_DATABASE_URL
const proxy = process.env.ACTIVITY_TEST_WS_PROXY
if (proxy) {
  if (!proxy.startsWith('127.0.0.1:')) throw new Error('Test websocket proxies must be local.')
  neonConfig.wsProxy = () => proxy
  neonConfig.useSecureWebSocket = false
  neonConfig.forceDisablePgSSL = true
  neonConfig.pipelineConnect = false
  neonConfig.poolQueryViaFetch = false
  neonConfig.webSocketConstructor = WebSocket
}

test.skipIf(!connection)('activity database and API preserve private history, monotonic snapshots, filters, links, and live membership', async () => {
  const client = new PrismaClient({ adapter: new PrismaNeon({ connectionString: connection!, options: '-c timezone=UTC' }) }), db = client as unknown as Database
  const organizationId = crypto.randomUUID(), alice = crypto.randomUUID(), bob = crypto.randomUUID(), id = crypto.randomUUID()
  let currentUser = alice
  try {
    await client.user.createMany({ data: [alice, bob].map((id) => ({ id, name: id, email: `${id}@example.com` })) })
    await client.organization.create({ data: { id: organizationId, name: 'Activity test', slug: organizationId } })
    await client.member.createMany({ data: [alice, bob].map((id) => ({ id, organizationId, userId: id, role: 'member' })) })
    const room = await client.room.create({ data: { organizationId, name: 'Launch room', createdByUserId: alice, members: { create: [alice, bob].map((id) => ({ organizationMemberId: id })) } } })
    const document = await client.document.create({ data: { organizationId, roomId: room.id, title: 'Launch plan', kind: 'DOCUMENT' } })
    const task = await client.plannerTask.create({ data: { organizationId, roomId: room.id, title: 'Launch task', createdByUserId: alice } })
    const identity = { organizationId, roomId: room.id, userId: alice, sessionId: 'test' }
    const job: PrivateAgentJob = { id, agentId: 'deleted-agent', agentName: 'Scout', instruction: 'ALICE PRIVATE REQUEST', reply: 'Saved plan', status: 'complete', source: 'scheduled', revision: 5,
      createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:01:00Z', startedAt: '2026-11-17T00:00:01Z', finishedAt: '2026-11-17T00:01:00Z',
      commits: [{ documentId: document.id, versionId: 'version', versionNumber: 1 }], taskCommits: [{ taskId: task.id, revision: 1 }],
    }
    await archiveAgentRun(db, identity, job)
    await archiveAgentRun(db, identity, { ...job, revision: 2, status: 'running', reply: 'stale' })
    await archiveAgentRun(db, identity, job)
    await archiveAgentRun(db, { ...identity, userId: bob }, { ...job, instruction: 'BOB PRIVATE REQUEST', reply: 'Bob answer' })
    expect(await client.agentActivityRun.count({ where: { organizationId } })).toBe(2)
    const saved = await client.agentActivityRun.findFirstOrThrow({ where: { organizationId, userId: alice } })
    expect(saved).toMatchObject({ revision: 5, status: 'complete', reply: 'Saved plan', source: 'scheduled' })
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('db', db); c.set('organizationId', organizationId)
      c.set('session', { user: { id: currentUser }, session: { id: 'test' } } as AppEnv['Variables']['session'])
      await next()
    })
    app.route('/activity', agentActivity)
    const page = await (await app.request('/activity')).json() as ActivityPage
    expect(page.runs).toHaveLength(1); expect(page.runs[0]).toMatchObject({ title: 'ALICE PRIVATE REQUEST', roomName: 'Launch room', documentCount: 1, taskCount: 1 })
    const detail = await (await app.request(`/activity/${room.id}/${id}`)).json() as ActivityDetail
    expect(detail).toMatchObject({ instruction: 'ALICE PRIVATE REQUEST', reply: 'Saved plan', documents: [{ title: 'Launch plan', available: true }], tasks: [{ title: 'Launch task', available: true }] })
    // Retained jobs can repair a pre-migration placeholder at the same revision.
    await client.agentActivityRun.updateMany({ where: { organizationId, userId: alice, id }, data: { reply: 'Old placeholder', evidence: {} } })
    const sourced: PrivateAgentJob = { ...job, reply: 'Saved plan [Plan](#source-plan)', sources: [{ id: 'plan', kind: 'document', scope: 'ROOM', title: 'Launch plan', body: 'Approved', roomId: room.id,
      documentId: document.id, messageId: null, updatedAt: job.updatedAt, citations: [{ quote: 'Approved', locator: 'Body', documentVersionId: 'version' }] }] }
    await archiveAgentRun(db, identity, sourced)
    await archiveAgentRun(db, identity, { ...sourced, revision: 2, reply: 'stale' })
    await archiveAgentRun(db, identity, { ...sourced, reply: 'duplicate must not overwrite' })
    const reopened = await (await app.request(`/activity/${room.id}/${id}`)).json() as ActivityDetail
    expect(reopened).toMatchObject({ reply: sourced.reply, citations: [{ sourceId: 'plan', quote: 'Approved', number: 1 }] })
    expect((await client.agentActivityRun.findFirstOrThrow({ where: { organizationId, userId: alice, id } })).evidence).toMatchObject({ sources: sourced.sources })
    const filtered = await (await app.request('/activity?status=failed')).json() as ActivityPage
    expect(filtered.runs).toHaveLength(0)
    const dateFiltered = await (await app.request('/activity?from=2026-11-18T00:00:00Z')).json() as ActivityPage
    expect(dateFiltered.runs).toHaveLength(0)
    currentUser = bob
    expect(JSON.stringify(await (await app.request('/activity')).json())).not.toContain('ALICE PRIVATE REQUEST')
    expect((await (await app.request(`/activity/${room.id}/${id}`)).json() as ActivityDetail).instruction).toBe('BOB PRIVATE REQUEST')
    currentUser = alice
    await client.roomMember.delete({ where: { roomId_organizationMemberId: { roomId: room.id, organizationMemberId: alice } } })
    expect((await (await app.request('/activity')).json() as ActivityPage).runs).toHaveLength(0)
    expect((await app.request(`/activity/${room.id}/${id}`)).status).toBe(404)
    expect(await client.agentActivityRun.count({ where: { organizationId, userId: alice } })).toBe(1)
  } finally {
    await client.organization.deleteMany({ where: { id: organizationId } })
    await client.user.deleteMany({ where: { id: { in: [alice, bob] } } })
    await client.$disconnect()
  }
}, 30_000)
