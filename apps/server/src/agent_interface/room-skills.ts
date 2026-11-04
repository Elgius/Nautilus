import { HTTPException } from 'hono/http-exception'
import type { Database } from '../db'
import type { Bindings } from '../env'
import { canChat, type ChatIdentity } from '../room-chat-service'
import { createDocumentService } from '../documents/document-service'
import { officeRequest } from '../office-service'
import type { SkillBackend } from './skills'

type WithDatabase = <T>(action: (db: Database) => Promise<T>) => Promise<T>

/** Identity is supplied by the authenticated socket, never by tool arguments. */
export function createRoomSkillBackend(env: Bindings, identity: ChatIdentity, agentId: string, withDatabase: WithDatabase): SkillBackend {
  const scope = (documentId: string) => ({ organizationId: identity.organizationId, roomId: identity.roomId, documentId })
  return {
    authorize: () => withDatabase(async (db) => {
      if (!await canChat(db, identity) || !await db.roomAgent.findFirst({
        where: { organizationId: identity.organizationId, roomId: identity.roomId, agentId }, select: { agentId: true },
      })) throw new HTTPException(403, { message: 'Room or agent access expired.' })
    }),
    list: () => withDatabase((db) => db.document.findMany({
      where: { organizationId: identity.organizationId, roomId: identity.roomId },
      select: { id: true, title: true, kind: true, currentVersionId: true },
      orderBy: { createdAt: 'asc' }, take: 100,
    })),
    read: (id, operation, args) => withDatabase(async (db) => {
      const saved = await createDocumentService(db, env).readDocument(scope(id))
      if (!saved.content || typeof saved.content !== 'object' || !('format' in saved.content) || saved.content.format !== 'univer') {
        throw new HTTPException(422, { message: 'Open and save this document in the editor before using agent tools.' })
      }
      const response = await officeRequest(env, '/read', JSON.stringify({ content: saved.content, operation, ...args }), true)
      return { currentVersionId: saved.currentVersionId, kind: saved.kind, result: await response.json() }
    }),
    edit: (id, expectedVersionId, kind, edits, changeSummary) => withDatabase(async (db) => {
      const service = createDocumentService(db, env)
      const saved = await service.readDocument(scope(id))
      if (saved.kind !== kind) throw new HTTPException(422, { message: 'Choose tools matching this document type.' })
      const { version } = await service.editDocument(scope(id), { expectedVersionId, edits, changeSummary }, { agentId })
      return { documentId: id, versionId: version.id, versionNumber: version.versionNumber, changeSummary: version.changeSummary }
    }),
  }
}
