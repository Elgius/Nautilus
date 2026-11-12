import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Database } from '../db'
import type { Prisma } from '../generated/prisma/client'

export const REFRESH_MS = 6 * 60 * 60 * 1000
export const scopeInput = z.enum(['PERSONAL', 'ORGANIZATION'])
export const tagInput = z.strictObject({
  scope: scopeInput,
  roomId: z.uuid(),
  documentId: z.uuid().optional(),
  messageId: z.uuid().optional(),
}).refine((v) => Boolean(v.documentId) !== Boolean(v.messageId), 'Tag exactly one document or message.')
export type KnowledgeIdentity = { organizationId: string; userId: string }
export type KnowledgeScope = z.infer<typeof scopeInput>
export const sourceInclude = {
  base: true,
  document: { select: { id: true, title: true, currentVersionId: true } },
  message: { select: { id: true, createdAt: true, editedAt: true } },
} as const
export type Source = Prisma.KnowledgeSourceGetPayload<{ include: typeof sourceInclude }>
type Store = Pick<Database, 'member' | 'roomMember'>
export const isAdmin = (role: string) => role.split(',').some((r) => ['owner', 'admin'].includes(r.trim()))

export async function sourceAccess(db: Store, source: Source) {
  if (source.revokedAt || (!source.document && !source.message)) return false
  const userId = source.base.scope === 'PERSONAL' ? source.base.ownerUserId : source.taggedByUserId
  if (!userId) return false
  const [member, roomMember] = await Promise.all([
    db.member.findUnique({ where: { organizationId_userId: { organizationId: source.organizationId, userId } }, select: { role: true } }),
    db.roomMember.findFirst({ where: { organizationId: source.organizationId, roomId: source.roomId, member: { organizationId: source.organizationId, userId } }, select: { role: true } }),
  ])
  return !!member && !!roomMember && (source.base.scope === 'PERSONAL' || isAdmin(member.role) || roomMember.role === 'OWNER')
}

export function entryIsCurrent(source: Source, entry: { sourceRevision: number } | null) {
  return !!entry && entry.sourceRevision === source.revision && source.lastProcessedRevision === source.revision &&
    (!source.document || source.document.currentVersionId === source.lastProcessedVersionId)
}

export function knowledgeService(db: Database, identity: KnowledgeIdentity) {
  const { organizationId, userId } = identity
  async function membership() {
    const member = await db.member.findUnique({ where: { organizationId_userId: identity }, select: { role: true } })
    if (!member) throw new HTTPException(404, { message: 'Organisation not found.' })
    return member
  }
  async function base(scope: KnowledgeScope) {
    await membership()
    const ownerUserId = scope === 'PERSONAL' ? userId : null
    // Partial unique indexes enforce these same rules against concurrent requests.
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([organizationId, ownerUserId])}, 0))`
      const existing = await tx.knowledgeBase.findFirst({ where: { organizationId, scope, ownerUserId } })
      return existing ?? tx.knowledgeBase.create({ data: { organizationId, scope, ownerUserId } })
    })
  }
  async function manage(scope: KnowledgeScope) {
    const member = await membership()
    if (scope === 'ORGANIZATION' && !isAdmin(member.role)) throw new HTTPException(403, { message: 'An organisation admin manages the shared knowledge agent.' })
  }
  return {
    base,
    async list(scope: KnowledgeScope, cursor?: string) {
      const knowledgeBase = await base(scope)
      const rows = await db.knowledgeSource.findMany({ where: { knowledgeBaseId: knowledgeBase.id, revokedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
        include: { ...sourceInclude, entry: true, runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, nextChunk: true, error: true, finishedAt: true } } }, orderBy: { id: 'asc' }, take: 26 })
      const sources = []
      const currentMember = await membership()
      for (const source of rows.slice(0, 25)) {
        const allowed = await sourceAccess(db, source)
        sources.push({ id: source.id, roomId: source.roomId, documentId: source.documentId, messageId: source.messageId,
          title: allowed ? source.document?.title ?? 'Tagged message' : 'Source access expired',
          available: allowed, taggedAt: source.taggedAt, lastError: allowed ? source.lastError : 'Source access expired. Remove this tag or restore access.',
          canRemove: scope === 'PERSONAL' || source.taggedByUserId === userId || isAdmin(currentMember.role),
          run: allowed ? source.runs[0] ?? null : null,
          entry: allowed && entryIsCurrent(source, source.entry) ? source.entry : null })
      }
      return { base: knowledgeBase, agent: { name: 'Knowledge', refreshHours: 6 }, sources, nextCursor: rows.length > 25 ? rows[24].id : null }
    },
    async tag(raw: unknown) {
      const input = tagInput.safeParse(raw)
      if (!input.success) throw new HTTPException(400, { message: input.error.issues[0]?.message ?? 'Choose a source.' })
      const { scope, roomId, documentId, messageId } = input.data
      const knowledgeBase = await base(scope)
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "knowledgeBase" WHERE id = ${knowledgeBase.id} FOR UPDATE`
        const proposed = { organizationId, roomId, taggedByUserId: userId, revokedAt: null, base: knowledgeBase,
          document: documentId ? await tx.document.findFirst({ where: { id: documentId, organizationId, roomId }, select: { id: true, title: true, currentVersionId: true } }) : null,
          message: messageId ? await tx.roomMessage.findFirst({ where: { id: messageId, organizationId, roomId, authorUserId: { not: null }, authorAgentId: null }, select: { id: true, createdAt: true, editedAt: true } }) : null,
        } as Source
        if (!await sourceAccess(tx, proposed)) throw new HTTPException(403, { message: scope === 'ORGANIZATION' ? 'A room owner or organisation admin with room access must approve sharing this source with the organisation.' : 'Join the source’s room before tagging it.' })
        if (documentId && !proposed.document?.currentVersionId) throw new HTTPException(422, { message: 'Save this document before tagging it for Knowledge.' })
        const where = { knowledgeBaseId: knowledgeBase.id, ...(documentId ? { documentId } : { messageId }) }
        const existing = await tx.knowledgeSource.findFirst({ where })
        if (existing && !existing.revokedAt) return { source: existing }
        const source = existing
          ? await tx.knowledgeSource.update({ where: { id: existing.id }, data: { revokedAt: null, taggedByUserId: userId, taggedAt: new Date(), revision: { increment: 1 }, lastError: null } })
          : await tx.knowledgeSource.create({ data: { organizationId, roomId, knowledgeBaseId: knowledgeBase.id, documentId, messageId, taggedByUserId: userId } })
        await tx.knowledgeBase.update({ where: { id: knowledgeBase.id }, data: { nextRefreshAt: new Date() } })
        return { source }
      })
    },
    async remove(scope: KnowledgeScope, sourceId: string) {
      const knowledgeBase = await base(scope), member = await membership()
      await db.$transaction(async (tx) => {
        const result = await tx.knowledgeSource.updateMany({ where: { id: sourceId, knowledgeBaseId: knowledgeBase.id,
          ...(scope === 'ORGANIZATION' && !isAdmin(member.role) ? { taggedByUserId: userId } : {}) },
          data: { revokedAt: new Date(), revision: { increment: 1 } } })
        if (!result.count) throw new HTTPException(404, { message: 'Source not found or you cannot remove this tag.' })
        // Cancel in-flight work and purge checkpoint findings immediately.
        await tx.knowledgeRun.updateMany({ where: { sourceId, status: { in: ['pending', 'running'] } }, data: { status: 'cancelled', findings: [], finishedAt: new Date(), leaseToken: null, leaseExpiresAt: null } })
      })
    },
    async configure(scope: KnowledgeScope, enabled: boolean) {
      await manage(scope)
      const knowledgeBase = await base(scope)
      return db.knowledgeBase.update({ where: { id: knowledgeBase.id }, data: { enabled, ...(enabled ? { nextRefreshAt: new Date() } : {}) } })
    },
    async refresh(scope: KnowledgeScope) {
      const knowledgeBase = await base(scope)
      if (!knowledgeBase.enabled) throw new HTTPException(409, { message: 'Resume the knowledge agent before refreshing.' })
      await db.knowledgeBase.update({ where: { id: knowledgeBase.id }, data: { nextRefreshAt: new Date() } })
    },
    async history(scope: KnowledgeScope, sourceId: string, before?: number) {
      const knowledgeBase = await base(scope)
      const source = await db.knowledgeSource.findFirst({ where: { id: sourceId, knowledgeBaseId: knowledgeBase.id }, include: sourceInclude })
      if (!source || !await sourceAccess(db, source)) throw new HTTPException(404, { message: 'Source unavailable.' })
      const revisions = await db.knowledgeEntryRevision.findMany({ where: { entry: { sourceId }, ...(before ? { revision: { lt: before } } : {}) }, include: { citations: true }, orderBy: { revision: 'desc' }, take: 11 })
      return { revisions: revisions.slice(0, 10), nextCursor: revisions.length > 10 ? revisions[9].revision : null }
    },
  }
}
