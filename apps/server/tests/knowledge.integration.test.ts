import { expect, test } from 'bun:test'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import { PrismaClient } from '../src/generated/prisma-tooling/client'
import type { Database } from '../src/db'
import type { Bindings } from '../src/env'
import { knowledgeService, REFRESH_MS } from '../src/knowledge/service'
import { enqueueKnowledge, processKnowledgeStep } from '../src/knowledge/runner'
import type { Chunk, Finding } from '../src/knowledge/content'

// Dedicated test DB only. Optional proxy supports a local, isolated Postgres test instance.
const connection = process.env.KNOWLEDGE_TEST_DATABASE_URL
const proxy = process.env.KNOWLEDGE_TEST_WS_PROXY
if (proxy) {
  if (!proxy.startsWith('127.0.0.1:')) throw new Error('Test websocket proxies must be local.')
  neonConfig.wsProxy = () => proxy
  neonConfig.useSecureWebSocket = false
  neonConfig.forceDisablePgSSL = true
  neonConfig.pipelineConnect = false
  neonConfig.poolQueryViaFetch = false
  neonConfig.webSocketConstructor = WebSocket
}
const env = {} as Bindings
const finding = (chunk: Chunk): Finding[] => [{ category: 'Progress', title: 'Evidence', body: chunk.text.slice(0, 200), evidence: chunk.text.slice(0, 100), locator: chunk.locator }]

test.skipIf(!connection)('knowledge database: tenant isolation, citations, six-hour cadence, chunk recovery and revocation', async () => {
  const client = new PrismaClient({ adapter: new PrismaNeon({ connectionString: connection!, options: '-c timezone=UTC' }) })
  const db = client as unknown as Database
  const org = crypto.randomUUID(), otherOrg = crypto.randomUUID(), owner = crypto.randomUUID(), teammate = crypto.randomUUID()
  let room = '', documentId = '', taggedMessageId = ''
  try {
    await client.user.createMany({ data: [owner, teammate].map((id) => ({ id, name: 'Knowledge test', email: `${id}@example.com` })) })
    await client.organization.createMany({ data: [org, otherOrg].map((id) => ({ id, name: 'Knowledge test', slug: id })) })
    await client.member.createMany({ data: [{ id: owner, organizationId: org, userId: owner, role: 'owner' }, { id: teammate, organizationId: org, userId: teammate, role: 'member' }] })
    const created = await client.room.create({ data: { organizationId: org, name: 'Test room', createdByUserId: owner, members: { create: [{ organizationMemberId: owner, role: 'OWNER' }, { organizationMemberId: teammate, role: 'MEMBER' }] } } })
    room = created.id
    const doc = await client.document.create({ data: { organizationId: org, roomId: room, kind: 'DOCUMENT', title: 'Release' } })
    documentId = doc.id
    const version = await client.documentVersion.create({ data: { organizationId: org, roomId: room, documentId, versionNumber: 1, authorUserId: owner, objectKey: crypto.randomUUID(), mimeType: 'application/json', sizeBytes: 1, checksum: 'test' } })
    await client.document.update({ where: { id: documentId }, data: { currentVersionId: version.id } })
    const message = await client.roomMessage.create({ data: { organizationId: org, roomId: room, authorUserId: owner, text: 'Tagged decision: release approved.' } })
    taggedMessageId = message.id
    await client.roomMessage.create({ data: { organizationId: org, roomId: room, authorUserId: owner, text: 'UNTAGGED PRIVATE CHAT MUST NOT BE READ' } })
    const own = knowledgeService(db, { organizationId: org, userId: owner }), peer = knowledgeService(db, { organizationId: org, userId: teammate })
    const ownBase = await own.base('PERSONAL'), peerBase = await peer.base('PERSONAL')
    expect(ownBase.id).not.toBe(peerBase.id)
    await expect(Promise.resolve(client.knowledgeBase.create({ data: { organizationId: org, scope: 'PERSONAL' } }))).rejects.toThrow()
    await expect(Promise.resolve(client.knowledgeBase.create({ data: { organizationId: org, scope: 'PERSONAL', ownerUserId: owner } }))).rejects.toThrow()
    expect(await own.base('PERSONAL')).toMatchObject({ id: ownBase.id })
    await expect(knowledgeService(db, { organizationId: otherOrg, userId: owner }).base('PERSONAL')).rejects.toThrow('Organisation not found')
    await expect(peer.tag({ scope: 'ORGANIZATION', roomId: room, documentId })).rejects.toThrow('approve sharing')
    const { source: personal } = await own.tag({ scope: 'PERSONAL', roomId: room, documentId })
    expect((await own.tag({ scope: 'PERSONAL', roomId: room, documentId })).source.id).toBe(personal.id)
    const { source: shared } = await own.tag({ scope: 'ORGANIZATION', roomId: room, messageId: taggedMessageId })
    expect((await peer.list('PERSONAL')).sources).toHaveLength(0)
    expect((await peer.list('ORGANIZATION')).sources).toHaveLength(1)
    await expect(peer.remove('ORGANIZATION', shared.id)).rejects.toThrow('cannot remove')
    await expect(peer.configure('ORGANIZATION', false)).rejects.toThrow('admin')

    const now = new Date()
    await enqueueKnowledge(db, now)
    expect((await client.knowledgeBase.findUniqueOrThrow({ where: { id: ownBase.id } })).nextRefreshAt.getTime()).toBe(now.getTime() + REFRESH_MS)
    const runs = await client.knowledgeRun.findMany({ where: { sourceId: { in: [personal.id, shared.id] }, status: 'pending' } })
    expect(runs).toHaveLength(2)
    await enqueueKnowledge(db, now)
    expect(await client.knowledgeRun.count({ where: { sourceId: personal.id } })).toBe(1)
    let readCount = 0, generated: string[] = []
    const deps = { readDocument: async () => { readCount++; return { currentVersionId: version.id, content: { format: 'markdown', text: 'Approved work. '.repeat(1500) } } }, generate: async (chunk: Chunk) => { generated.push(chunk.text); return finding(chunk) } }
    const docRun = runs.find((r) => r.sourceId === personal.id)!
    const nextAt = await processKnowledgeStep(db, env, docRun.id, deps)
    expect(nextAt).toBeInstanceOf(Date)
    expect(await client.knowledgeEntry.count({ where: { sourceId: personal.id } })).toBe(0)
    const checkpoint = await client.knowledgeRun.findUniqueOrThrow({ where: { id: docRun.id } })
    expect(checkpoint.nextChunk).toBe(1)
    await client.knowledgeRun.update({ where: { id: docRun.id }, data: { status: 'running', leaseToken: 'dead-worker', leaseExpiresAt: new Date(0) } })
    await processKnowledgeStep(db, env, docRun.id, deps)
    expect(readCount).toBe(2)
    expect(generated.join('')).toBe('Approved work. '.repeat(1500))
    expect((await own.list('PERSONAL')).sources[0].entry).not.toBeNull()
    const history = await own.history('PERSONAL', personal.id)
    expect(history.revisions[0].citations).toHaveLength(2)
    expect(history.revisions[0].citations.every((c) => c.documentVersionId === version.id)).toBe(true)

    generated = []
    await processKnowledgeStep(db, env, runs.find((r) => r.sourceId === shared.id)!.id, { generate: async (chunk) => { generated.push(chunk.text); return finding(chunk) } })
    expect(generated).toEqual(['Tagged decision: release approved.'])
    expect((await peer.list('ORGANIZATION')).sources[0].entry?.body).toContain('release approved')
    expect((await own.history('ORGANIZATION', shared.id)).revisions[0].citations[0].quote).toBe('Tagged decision: release approved.')
    expect((await peer.list('PERSONAL')).sources).toHaveLength(0)
    await expect(peer.history('PERSONAL', personal.id)).rejects.toThrow('unavailable')

    // Unchanged six-hour checks do not read storage or call the model.
    await own.refresh('PERSONAL'); await enqueueKnowledge(db)
    const unchanged = await client.knowledgeRun.findFirstOrThrow({ where: { sourceId: personal.id, status: 'pending' } })
    await processKnowledgeStep(db, env, unchanged.id, { readDocument: async () => { throw new Error('Unchanged source must not be read') }, generate: async () => { throw new Error('Unchanged source must not call AI') } })
    expect((await client.knowledgeRun.findUniqueOrThrow({ where: { id: unchanged.id } })).status).toBe('complete')

    // Document saves invalidate reports for all writers, and failed runs retry with
    // redacted errors while preserving the previous revision in history.
    const version2 = await client.documentVersion.create({ data: { organizationId: org, roomId: room, documentId, versionNumber: 2, authorUserId: owner, objectKey: crypto.randomUUID(), mimeType: 'application/json', sizeBytes: 1, checksum: 'test' } })
    await client.document.update({ where: { id: documentId }, data: { currentVersionId: version2.id } })
    expect((await own.list('PERSONAL')).sources[0].entry).toBeNull()
    await enqueueKnowledge(db)
    const failedRun = await client.knowledgeRun.findFirstOrThrow({ where: { sourceId: personal.id, status: 'pending' } })
    const failureDeps = { readDocument: async () => ({ currentVersionId: version2.id, content: { format: 'markdown', text: 'Updated source.' } }), generate: async (): Promise<Finding[]> => { throw new Error('PRIVATE-PROVIDER-SECRET') } }
    for (let attempt = 0; attempt < 3; attempt++) {
      await client.knowledgeRun.update({ where: { id: failedRun.id }, data: { nextAttemptAt: new Date(0) } })
      await processKnowledgeStep(db, env, failedRun.id, failureDeps)
    }
    const failed = await client.knowledgeRun.findUniqueOrThrow({ where: { id: failedRun.id } })
    expect(failed.status).toBe('failed'); expect(failed.attempts).toBe(3)
    expect(failed.error).not.toContain('PRIVATE-PROVIDER-SECRET')
    expect(failed.findings).toEqual([])
    expect((await own.history('PERSONAL', personal.id)).revisions).toHaveLength(1)
    await own.refresh('PERSONAL'); await enqueueKnowledge(db)
    const pausedRun = await client.knowledgeRun.findFirstOrThrow({ where: { sourceId: personal.id, status: 'pending' } })
    await own.configure('PERSONAL', false)
    await processKnowledgeStep(db, env, pausedRun.id, { readDocument: async () => { throw new Error('Paused agent must not read') } })
    expect((await client.knowledgeRun.findUniqueOrThrow({ where: { id: pausedRun.id } })).status).toBe('cancelled')
    await expect(own.refresh('PERSONAL')).rejects.toThrow('Resume')
    await own.configure('PERSONAL', true); await enqueueKnowledge(db)
    const resumedRun = await client.knowledgeRun.findFirstOrThrow({ where: { sourceId: personal.id, status: 'pending' } })
    await processKnowledgeStep(db, env, resumedRun.id, { readDocument: failureDeps.readDocument, generate: async (chunk) => finding(chunk) })
    expect((await own.list('PERSONAL')).sources[0].entry?.revision).toBe(2)

    // SQL trigger invalidates findings synchronously for every persisted message writer.
    await client.roomMessage.update({ where: { id: taggedMessageId }, data: { text: 'Changed decision: release delayed.' } })
    expect((await peer.list('ORGANIZATION')).sources[0].entry).toBeNull()
    await enqueueKnowledge(db)
    const edited = await client.knowledgeRun.findFirstOrThrow({ where: { sourceId: shared.id, status: 'pending' } })
    await processKnowledgeStep(db, env, edited.id, { generate: async (chunk) => { await own.remove('ORGANIZATION', shared.id); return finding(chunk) } })
    expect((await peer.list('ORGANIZATION')).sources).toHaveLength(0)
    expect(await client.knowledgeEntryRevision.count({ where: { entry: { sourceId: shared.id } } })).toBe(1)
    expect((await client.knowledgeRun.findUniqueOrThrow({ where: { id: edited.id } })).status).toBe('cancelled')
    await expect(own.history('ORGANIZATION', shared.id)).rejects.toThrow('unavailable')

    // Losing access also hides already-generated knowledge, including history.
    await client.roomMember.delete({ where: { roomId_organizationMemberId: { roomId: room, organizationMemberId: owner } } })
    expect((await own.list('PERSONAL')).sources[0].entry).toBeNull()
    await expect(own.history('PERSONAL', personal.id)).rejects.toThrow('unavailable')
  } finally {
    await client.document.updateMany({ where: { organizationId: org }, data: { currentVersionId: null } })
    await client.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } })
    await client.user.deleteMany({ where: { id: { in: [owner, teammate] } } })
    await client.$disconnect()
  }
}, 60_000)
