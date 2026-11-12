import type { Database } from '../db'
import type { Bindings } from '../env'
import { createDocumentService } from '../documents/document-service'
import { createAgentModel } from '../ai'
import { sourceAccess, sourceInclude, REFRESH_MS, type Source } from './service'
import { documentChunks, textChunks, reportBody, type Chunk, type Finding } from './content'
import { generateFindings } from './generate'

export const LEASE_MS = 180_000
const MAX_ATTEMPTS = 3
export async function hashText(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map((n) => n.toString(16).padStart(2, '0')).join('')
}

/** Cron queues checks, never performs model calls. Bounded bases and deliveries per tick. */
export async function enqueueKnowledge(db: Database, now = new Date()) {
  await db.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "knowledgeBase" WHERE enabled = true AND "nextRefreshAt" <= ${now}
      ORDER BY "nextRefreshAt", id LIMIT 4 FOR UPDATE SKIP LOCKED`
    for (const base of due) {
      // One active run per source, enforced by a partial unique index. Replays do not duplicate work.
      await tx.$executeRaw`INSERT INTO "knowledgeRun" (id, "sourceId", "sourceRevision", trigger, "createdAt", "nextAttemptAt")
        SELECT gen_random_uuid()::text, id, revision, 'refresh', ${now}, ${now} FROM "knowledgeSource"
        WHERE "knowledgeBaseId" = ${base.id} AND "revokedAt" IS NULL ON CONFLICT DO NOTHING`
      await tx.knowledgeBase.update({ where: { id: base.id }, data: { lastCheckedAt: now, nextRefreshAt: new Date(now.getTime() + REFRESH_MS) } })
    }
  })
}
export async function dispatchKnowledge(db: Database, env: Bindings, now = new Date()) {
  if (!env.KNOWLEDGE_WORKER) return
  await enqueueKnowledge(db, now)
  const runs = await db.knowledgeRun.findMany({ where: { OR: [
    { status: 'pending', nextAttemptAt: { lte: now } }, { status: 'running', leaseExpiresAt: { lte: now } },
  ] }, orderBy: { nextAttemptAt: 'asc' }, take: 8, select: { id: true } })
  const namespace = env.KNOWLEDGE_WORKER
  const results = await Promise.allSettled(runs.map(async ({ id }) => {
    const response = await namespace.get(namespace.idFromName(id)).fetch(new Request('https://knowledge.internal/wake', {
      method: 'POST', body: JSON.stringify({ runId: id }), signal: AbortSignal.timeout(10_000),
    }))
    await response.body?.cancel()
    if (!response.ok) throw new Error('Knowledge dispatch failed.')
  }))
  if (results.some((r) => r.status === 'rejected')) throw new Error('Knowledge dispatch failed; pending runs will retry.')
}

type Dependencies = {
  readDocument?: (source: Source) => Promise<{ content: unknown; currentVersionId: string | null }>
  generate?: (chunk: Chunk) => Promise<Finding[]>
}

/** One source chunk per durable alarm. No general chat, previous runs, or unrelated sources. */
export async function processKnowledgeStep(db: Database, env: Bindings, runId: string, deps: Dependencies = {}): Promise<Date | null> {
  const now = new Date(), token = crypto.randomUUID()
  const claimed = await db.knowledgeRun.updateMany({ where: { id: runId, OR: [
    { status: 'pending', nextAttemptAt: { lte: now } }, { status: 'running', leaseExpiresAt: { lte: now } },
  ] }, data: { status: 'running', leaseToken: token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), startedAt: now } })
  if (!claimed.count) return null
  const lease = { id: runId, status: 'running', leaseToken: token }
  const run = await db.knowledgeRun.findUniqueOrThrow({ where: { id: runId }, include: { source: { include: sourceInclude } } })
  async function cancel(reschedule = false) {
    await db.$transaction(async (tx) => {
      const changed = await tx.knowledgeRun.updateMany({ where: lease, data: { status: 'cancelled', findings: [], leaseToken: null, leaseExpiresAt: null, finishedAt: new Date() } })
      if (changed.count && reschedule && run.source.base.enabled) await tx.knowledgeBase.update({ where: { id: run.source.knowledgeBaseId }, data: { nextRefreshAt: new Date() } })
    })
    return null
  }
  try {
    const source = run.source
    if (!source.base.enabled || !await sourceAccess(db, source)) return await cancel()
    if (source.revision !== run.sourceRevision) return await cancel(true)
    if (source.lastProcessedRevision === source.revision && (!source.document || source.lastProcessedVersionId === source.document.currentVersionId)) {
      await db.knowledgeRun.updateMany({ where: lease, data: { status: 'complete', finishedAt: new Date(), leaseToken: null, leaseExpiresAt: null, findings: [] } })
      return null
    }
    let chunks: Chunk[], versionId: string | null = null, sourceHash: string
    if (source.document) {
      const saved = await (deps.readDocument ? deps.readDocument(source) : createDocumentService(db, env).readDocument({ organizationId: source.organizationId, roomId: source.roomId, documentId: source.document.id }))
      versionId = saved.currentVersionId
      if (!versionId || versionId !== source.document.currentVersionId) return await cancel(true)
      chunks = documentChunks(saved.content)
      sourceHash = await hashText(JSON.stringify(saved.content))
    } else {
      // Exact tagged message only. Linked documents and neighbouring messages are never fetched.
      const message = await db.roomMessage.findFirst({ where: { id: source.messageId!, organizationId: source.organizationId, roomId: source.roomId }, select: { text: true } })
      if (!message) return await cancel()
      chunks = textChunks(message.text, `Message ${source.messageId}`)
      sourceHash = await hashText(message.text)
    }
    if (run.sourceHash && (run.sourceHash !== sourceHash || run.documentVersionId !== versionId)) return await cancel(true)
    // A tag/access change during storage I/O must be noticed before sending
    // source text to the model, as well as before publishing its result.
    const readable = await db.knowledgeSource.findUnique({ where: { id: source.id }, include: sourceInclude })
    if (!readable || !readable.base.enabled || !await sourceAccess(db, readable)) return await cancel()
    if (readable.revision !== run.sourceRevision) return await cancel(true)
    const findings = run.findings as Finding[]
    const chunk = chunks[run.nextChunk]
    if (chunk) findings.push(...await (deps.generate ? deps.generate(chunk) : generateFindings(chunk, createAgentModel(env))))
    const nextChunk = run.nextChunk + (chunk ? 1 : 0)
    const complete = nextChunk >= chunks.length
    const nextAt = new Date(Date.now() + 1000)
    return await db.$transaction(async (tx) => {
      // Tag removal and source edits take this row lock too. Membership locks keep
      // revocation from racing the final authorization check and publication.
      await tx.$queryRaw`SELECT id FROM "knowledgeSource" WHERE id = ${source.id} FOR UPDATE`
      const current = await tx.knowledgeSource.findUnique({ where: { id: source.id }, include: sourceInclude })
      const principal = source.base.scope === 'PERSONAL' ? source.base.ownerUserId : source.taggedByUserId
      await tx.$queryRaw`SELECT m.id FROM member m JOIN "roomMember" r ON r."organizationMemberId" = m.id AND r."organizationId" = m."organizationId"
        WHERE m."organizationId" = ${source.organizationId} AND m."userId" = ${principal} AND r."roomId" = ${source.roomId} FOR SHARE OF m, r`
      if (!current || !current.base.enabled || current.revision !== run.sourceRevision ||
        (current.document && current.document.currentVersionId !== versionId) || !await sourceAccess(tx, current)) {
        const cancelled = await tx.knowledgeRun.updateMany({ where: lease, data: { status: 'cancelled', findings: [], finishedAt: new Date(), leaseToken: null, leaseExpiresAt: null } })
        if (cancelled.count && current?.base.enabled && !current.revokedAt && current.revision !== run.sourceRevision) await tx.knowledgeBase.update({ where: { id: current.knowledgeBaseId }, data: { nextRefreshAt: new Date() } })
        return null
      }
      // Fence writes from expired/replaced workers; the entire checkpoint is atomic.
      const changed = await tx.knowledgeRun.updateMany({ where: { ...lease, leaseExpiresAt: { gt: new Date() } }, data: {
        status: complete ? 'complete' : 'pending', nextChunk, findings: complete ? [] : findings,
        sourceHash, documentVersionId: versionId, nextAttemptAt: nextAt, attempts: 0,
        leaseToken: null, leaseExpiresAt: null, error: null, ...(complete ? { finishedAt: new Date() } : {}),
      } })
      if (!changed.count) return null
      if (!complete) return nextAt
      const title = current.document?.title ?? 'Tagged message', body = reportBody(findings)
      const entry = await tx.knowledgeEntry.upsert({ where: { sourceId: source.id },
        create: { sourceId: source.id, title, body, sourceRevision: source.revision },
        update: { title, body, sourceRevision: source.revision, revision: { increment: 1 } } })
      await tx.knowledgeEntryRevision.create({ data: {
        entryId: entry.id, revision: entry.revision, sourceRevision: source.revision, title, body, runId,
        citations: { create: (findings.length ? [...new Map(findings.map((finding) => [`${finding.locator}\n${finding.evidence}`, { locator: finding.locator, quote: finding.evidence }])).values()]
          : chunks.map((item) => ({ locator: item.locator, quote: '' }))).map((evidence) => ({
          documentVersionId: versionId, messageHash: versionId ? null : sourceHash, ...evidence,
        })) },
      } })
      await tx.knowledgeSource.update({ where: { id: source.id }, data: { lastProcessedRevision: source.revision, lastProcessedVersionId: versionId, lastProcessedHash: sourceHash, lastError: null } })
      return null
    }, { timeout: 15_000 })
  } catch {
    // Provider/DB errors can contain secrets or raw sources. Persist a generic error only.
    const failed = run.attempts + 1 >= MAX_ATTEMPTS
    const nextAt = new Date(Date.now() + 60_000 * 2 ** run.attempts)
    await db.$transaction(async (tx) => {
      const changed = await tx.knowledgeRun.updateMany({ where: lease, data: { status: failed ? 'failed' : 'pending', attempts: { increment: 1 }, nextAttemptAt: nextAt,
        error: 'Knowledge could not process this source. Check AI/storage configuration and refresh to retry.', leaseToken: null, leaseExpiresAt: null,
        ...(failed ? { finishedAt: new Date(), findings: [] } : {}),
      } })
      if (changed.count) await tx.knowledgeSource.updateMany({ where: { id: run.sourceId }, data: { lastError: 'Knowledge could not process this source. Refresh to retry.' } })
    })
    return failed ? null : nextAt
  }
}
