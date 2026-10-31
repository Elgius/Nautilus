import { HTTPException } from 'hono/http-exception'
import type { Database } from '../db'
import type { Bindings } from '../env'
import { createStorage } from '../storage'
import { parseContent, text } from '../room-validation'
import { MAX_OFFICE_BYTES, validateOfficeContent } from '../office-content'
import { officeRequest } from '../office-service'
import type { DocumentEdit } from '../../../office/src/editing/docs'
import type { SpreadsheetEdit } from '../../../office/src/editing/spreadsheets'

export type DocumentScope = { organizationId: string; roomId: string; documentId: string }
export type DocumentActor = { userId: string; agentId?: never } | { agentId: string; userId?: never }
export const versionSelect = { id: true, versionNumber: true, sizeBytes: true, mimeType: true, checksum: true,
  changeSummary: true, createdAt: true, authorUser: { select: { name: true } }, authorAgent: { select: { name: true } } } as const
type Storage = Pick<ReturnType<typeof createStorage>, 'get' | 'put'>
const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join('')

/** Construct only with an authenticated organization scope, never model-supplied identity. */
export function createDocumentService(db: Database, env: Bindings, storage?: Storage) {
  const store = () => storage ?? createStorage(env)
  async function document(scope: DocumentScope) {
    const result = await db.document.findFirst({ where: { id: scope.documentId, organizationId: scope.organizationId, roomId: scope.roomId },
      include: { currentVersion: { select: { versionNumber: true, objectKey: true, checksum: true, sizeBytes: true } } } })
    if (!result) throw new HTTPException(404, { message: 'Document not found.' })
    return result
  }
  async function checkActor(scope: DocumentScope, actor: DocumentActor) {
    if (actor.agentId !== undefined) {
      if (actor.userId !== undefined || !await db.roomAgent.findFirst({ where: { organizationId: scope.organizationId, roomId: scope.roomId, agentId: actor.agentId }, select: { agentId: true } })) {
        throw new HTTPException(403, { message: 'Choose an agent assigned to this room.' })
      }
    } else if (!actor.userId) throw new HTTPException(400, { message: 'Provide a document author.' })
  }
  async function readDocument(scope: DocumentScope) {
    const found = await document(scope)
    if (!found.currentVersion) return { content: null, currentVersionId: null, kind: found.kind }
    const payload = await store().get(found.currentVersion.objectKey)
    const bytes = new TextEncoder().encode(payload)
    if (await digest(bytes) !== found.currentVersion.checksum || bytes.byteLength !== found.currentVersion.sizeBytes) {
      throw new HTTPException(502, { message: 'The stored document failed its integrity check.' })
    }
    return { content: JSON.parse(payload) as unknown, currentVersionId: found.currentVersionId, kind: found.kind }
  }
  async function saveVersion(scope: DocumentScope, input: { expectedVersionId: string | null; content: unknown; changeSummary?: string | null }, actor: DocumentActor) {
    await checkActor(scope, actor)
    const found = await document(scope)
    if (input.expectedVersionId !== found.currentVersionId) throw new HTTPException(409, { message: 'A newer document version exists. Reload before saving.' })
    const payload = parseContent(found.kind, input.content), bytes = new TextEncoder().encode(payload)
    if (bytes.byteLength > MAX_OFFICE_BYTES) throw new HTTPException(413, { message: 'Keep document versions within 10 MB.' })
    const checksum = await digest(bytes), id = crypto.randomUUID()
    const objectKey = `organizations/${scope.organizationId}/rooms/${scope.roomId}/documents/${scope.documentId}/versions/${id}.json`
    const changeSummary = input.changeSummary == null ? null : text(input.changeSummary, 'Change summary', 500, true)
    await store().put(objectKey, payload)
    // Preserve unreferenced objects for reconciliation if the DB commit fails.
    try {
      return await db.$transaction(async (tx) => {
        // A concurrent writer is detected by the unique version number or the head comparison.
        const version = await tx.documentVersion.create({ data: { id, ...scope, objectKey,
          versionNumber: (found.currentVersion?.versionNumber ?? 0) + 1, mimeType: 'application/json', sizeBytes: bytes.byteLength, checksum,
          ...(actor.agentId !== undefined ? { authorAgentId: actor.agentId } : { authorUserId: actor.userId }), changeSummary }, select: versionSelect })
        const updated = await tx.document.updateMany({ where: { id: scope.documentId, organizationId: scope.organizationId, roomId: scope.roomId, currentVersionId: found.currentVersionId }, data: { currentVersionId: id } })
        if (updated.count !== 1) throw new HTTPException(409, { message: 'A newer document version exists. Reload before saving.' })
        await tx.room.update({ where: { id: scope.roomId, organizationId: scope.organizationId }, data: { lastActivityAt: new Date() } })
        return version
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new HTTPException(409, { message: 'A newer document version exists. Reload before saving.' })
      throw error
    }
  }
  async function editDocument(scope: DocumentScope, input: { expectedVersionId: string | null; edits: DocumentEdit[] | SpreadsheetEdit[]; changeSummary?: string }, actor: DocumentActor) {
    await checkActor(scope, actor)
    const saved = await readDocument(scope)
    if (saved.currentVersionId !== input.expectedVersionId) throw new HTTPException(409, { message: 'A newer document version exists. Reload before editing.' })
    if (!saved.content || typeof saved.content !== 'object' || !('format' in saved.content) || saved.content.format !== 'univer') {
      throw new HTTPException(422, { message: 'Open and save this document in the Univer editor before editing it with tools.' })
    }
    const response = await officeRequest(env, '/edit', JSON.stringify({ content: saved.content, edits: input.edits }), true)
    const result = await response.json() as { content: unknown }
    const content = validateOfficeContent(saved.kind, result.content)
    const version = await saveVersion(scope, { expectedVersionId: input.expectedVersionId, content, changeSummary: input.changeSummary }, actor)
    return { content, version }
  }
  return { readDocument, saveVersion, editDocument }
}
