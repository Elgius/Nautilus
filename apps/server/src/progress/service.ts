import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Database } from '../db'
import { canChat, scheduledTaskAvailable, type ChatIdentity } from '../room-chat-service'
import { guardRoomWrite } from '../documents/room-write-lock'

const notes = z.array(z.string().trim().min(1).max(1000)).max(30)
const documentReference = z.strictObject({ documentId: z.string().min(1).max(200), versionId: z.string().min(1).max(200) })
export const saveProgressInput = z.strictObject({
  progressId: z.uuid(), requestId: z.uuid().describe('Stable ID for this save. Retry with identical input and requestId.'),
  expectedRevision: z.number().int().min(0).max(2_147_483_646).describe('0 creates new progress; otherwise use the revision from readProgress.'),
  title: z.string().trim().min(1).max(200), objective: z.string().trim().min(1).max(4000),
  completed: notes, remaining: notes, blockers: notes,
  documents: z.array(documentReference).max(30).refine((refs) => new Set(refs.map((ref) => ref.documentId)).size === refs.length, 'Use one version reference per document.'),
  status: z.enum(['active', 'blocked', 'complete']),
}).refine((input) => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 24_000, 'Keep progress within 24 KB.')
export const readProgressInput = z.strictObject({ progressId: z.uuid().optional(), after: z.uuid().optional() })
  .refine((input) => !input.progressId || !input.after, 'Use progressId to read or after to paginate, not both.')
type Reference = z.infer<typeof documentReference>
type Actor = { agentId: string; workToken: string; runId: string }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (!result.success) throw new HTTPException(422, { message: 'Invalid progress input. Check field limits, references and revision.' })
  return result.data
}

/** Scope comes only from the authenticated run. Notes are never broadcast to the room. */
export function progressService(db: Database, identity: ChatIdentity, actor: Actor) {
  const room = { organizationId: identity.organizationId, roomId: identity.roomId }
  const scope = { ...room, userId: identity.userId, agentId: actor.agentId }
  async function authorize(source = db) {
    if (!await canChat(source, identity) || !await scheduledTaskAvailable(source, identity) ||
      !await source.roomAgent.findFirst({ where: { ...room, agentId: actor.agentId }, select: { agentId: true } })) {
      throw new HTTPException(403, { message: 'Room or agent access expired.' })
    }
  }
  return {
    async read(raw: unknown, signal?: AbortSignal) {
      const input = parse(readProgressInput, raw)
      signal?.throwIfAborted(); await authorize(); signal?.throwIfAborted()
      if (!input.progressId) {
        const rows = await db.agentProgress.findMany({ where: { ...scope, ...(input.after ? { id: { gt: input.after } } : {}) },
          orderBy: { id: 'asc' }, take: 21,
          select: { id: true, title: true, status: true, revision: true, updatedAt: true } })
        return { progress: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].id : null }
      }
      const progress = await db.agentProgress.findFirst({ where: { ...scope, id: input.progressId } })
      if (!progress) throw new HTTPException(404, { message: 'Progress not found.' })
      const references = z.array(documentReference).parse(progress.documents)
      const documents = await db.document.findMany({ where: { ...room, id: { in: references.map((ref) => ref.documentId) } }, select: { id: true, currentVersionId: true } })
      signal?.throwIfAborted()
      return { progress, documentStates: references.map((ref) => {
        const document = documents.find((document) => document.id === ref.documentId)
        return { ...ref, currentVersionId: document?.currentVersionId ?? null,
          state: !document ? 'missing' : document.currentVersionId === ref.versionId ? 'current' : 'changed' }
      }) }
    },
    async save(raw: unknown, signal?: AbortSignal) {
      const input = parse(saveProgressInput, raw)
      signal?.throwIfAborted(); await authorize(); signal?.throwIfAborted()
      if (!actor.workToken || !actor.runId) throw new HTTPException(423, { message: 'Progress saving requires an active agent run.' })
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)))
      const requestHash = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const { progressId: id, requestId, expectedRevision, ...fields } = input
      return db.$transaction(async (tx) => {
        signal?.throwIfAborted()
        await guardRoomWrite(tx, room, actor.workToken)
        await authorize(tx as Database)
        const receipt = await tx.agentProgressSave.findUnique({ where: { organizationId_roomId_userId_agentId_requestId: { ...scope, requestId } } })
        if (receipt) {
          if (receipt.requestHash !== requestHash) throw new HTTPException(409, { message: 'This progress request ID was already used with different input.' })
          return { progressId: receipt.progressId, revision: receipt.revision, saved: true, replayed: true }
        }
        const existing = await tx.agentProgress.findFirst({ where: { ...scope, id }, select: { revision: true } })
        if ((existing?.revision ?? 0) !== expectedRevision) throw new HTTPException(409, { message: 'Progress changed. Read it again before saving.' })
        const refs: Reference[] = input.documents
        if (refs.length) {
          const count = await tx.documentVersion.count({ where: { ...room, OR: refs.map((ref) => ({ documentId: ref.documentId, id: ref.versionId })) } })
          if (count !== refs.length) throw new HTTPException(422, { message: 'Reference saved document versions from this room only.' })
        }
        const revision = expectedRevision + 1
        if (existing) {
          const result = await tx.agentProgress.updateMany({ where: { ...scope, id, revision: expectedRevision }, data: { ...fields, revision, updatedRunId: actor.runId } })
          if (result.count !== 1) throw new HTTPException(409, { message: 'Progress changed. Read it again before saving.' })
        } else {
          await tx.agentProgress.create({ data: { ...scope, id, ...fields, revision, createdRunId: actor.runId, updatedRunId: actor.runId } })
        }
        await tx.agentProgressSave.create({ data: { ...scope, requestId, progressId: id, requestHash, revision, runId: actor.runId } })
        signal?.throwIfAborted()
        return { progressId: id, revision, saved: true, replayed: false }
      })
    },
  }
}
