import { HTTPException } from 'hono/http-exception'
import type { Database } from '../db'
import type { Bindings } from '../env'
import { canChat, scheduledTaskAvailable, type ChatIdentity } from '../room-chat-service'
import { createDocumentService } from '../documents/document-service'
import { officeRequest } from '../office-service'
import type { SkillBackend } from './skills'

type WithDatabase = <T>(action: (db: Database) => Promise<T>) => Promise<T>

/** Identity is supplied by the authenticated socket, never by tool arguments. */
export function createRoomSkillBackend(env: Bindings, identity: ChatIdentity, agentId: string, withDatabase: WithDatabase, workToken: string, runId?: string): SkillBackend {
  const scope = (documentId: string) => ({ organizationId: identity.organizationId, roomId: identity.roomId, documentId })
  return {
    authorize: () => withDatabase(async (db) => {
      if (!await canChat(db, identity) || !await scheduledTaskAvailable(db, identity) || !await db.roomAgent.findFirst({
        where: { organizationId: identity.organizationId, roomId: identity.roomId, agentId }, select: { agentId: true },
      })) throw new HTTPException(403, { message: 'Room or agent access expired.' })
    }),
    list: (options = {}, signal) => withDatabase(async (db) => {
      signal?.throwIfAborted()
      const documents = await db.document.findMany({
        where: { organizationId: identity.organizationId, roomId: identity.roomId,
          ...(options.after ? { id: { gt: options.after } } : {}),
          ...(options.title ? { title: { contains: options.title, mode: 'insensitive' } } : {}),
        },
        select: { id: true, title: true, kind: true, currentVersionId: true },
        orderBy: { id: 'asc' }, take: 101,
      })
      signal?.throwIfAborted()
      return { documents: documents.slice(0, 100), nextCursor: documents.length > 100 ? documents[99].id : null }
    }),
    read: (id, operation, args, signal) => withDatabase(async (db) => {
      const saved = await createDocumentService(db, env).readDocument(scope(id))
      if (!saved.content || typeof saved.content !== 'object' || !('format' in saved.content) || saved.content.format !== 'univer') {
        throw new HTTPException(422, { message: 'Open and save this document in the editor before using agent tools.' })
      }
      const response = await officeRequest(env, '/read', JSON.stringify({ content: saved.content, operation, ...args }), true, signal)
      return { currentVersionId: saved.currentVersionId, kind: saved.kind, result: await response.json() }
    }),
    findCreation: (input, signal) => withDatabase(async (db) => {
      signal?.throwIfAborted()
      return createDocumentService(db, env).findCreation({ organizationId: identity.organizationId, roomId: identity.roomId }, input, identity.userId)
    }),
    ...(runId ? { create: (input, signal) => withDatabase((db) => createDocumentService(db, env).createDocument(
      { organizationId: identity.organizationId, roomId: identity.roomId }, input,
      { userId: identity.userId, agentId, workToken, runId }, signal)) } satisfies Pick<SkillBackend, 'create'> : {}),
    edit: (id, expectedVersionId, kind, edits, changeSummary, signal) => withDatabase(async (db) => {
      const service = createDocumentService(db, env)
      const saved = await service.readDocument(scope(id))
      if (saved.kind !== kind) throw new HTTPException(422, { message: 'Choose tools matching this document type.' })
      const { version } = await service.editDocument(scope(id), { expectedVersionId, edits, changeSummary }, { agentId, workToken }, signal)
      return { documentId: id, versionId: version.id, versionNumber: version.versionNumber, changeSummary: version.changeSummary }
    }),
  }
}
