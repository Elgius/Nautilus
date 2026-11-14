import { creationContent, parseCreation, type DocumentCreation, type CreationResult } from './creation'
import { HTTPException } from 'hono/http-exception'
import type { Database } from '../db'
import type { Bindings } from '../env'
import { createStorage } from '../storage'
import { parseContent, text } from '../room-validation'
import { MAX_OFFICE_BYTES, validateOfficeContent } from '../office-content'
import { officeRequest } from '../office-service'
import type { DocumentEdit } from '../../../office/src/editing/docs'
import type { SpreadsheetEdit } from '../../../office/src/editing/spreadsheets'
import { guardRoomWrite } from './room-write-lock'
import { SkillOperationError } from '../skill-operation-error'

export type DocumentScope = { organizationId: string; roomId: string; documentId: string }
export type DocumentActor = { userId: string; agentId?: never; workToken?: never } | { agentId: string; userId?: never; workToken: string }
export const versionSelect = { id: true, versionNumber: true, sizeBytes: true, mimeType: true, checksum: true,
  changeSummary: true, createdAt: true, authorUser: { select: { name: true } }, authorAgent: { select: { name: true } } } as const
type Storage = { get: (key: string) => Promise<string>; put: (key: string, body: string) => Promise<void> }
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
      if (!actor.workToken) throw new HTTPException(423, { message: 'Agent edits require an active room work lease.' })
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
  async function saveVersion(scope: DocumentScope, input: { expectedVersionId: string | null; content: unknown; changeSummary?: string | null }, actor: DocumentActor, signal?: AbortSignal) {
    signal?.throwIfAborted()
    await checkActor(scope, actor)
    const found = await document(scope)
    if (input.expectedVersionId !== found.currentVersionId) throw new HTTPException(409, { message: 'A newer document version exists. Reload before saving.' })
    const payload = parseContent(found.kind, input.content), bytes = new TextEncoder().encode(payload)
    if (bytes.byteLength > MAX_OFFICE_BYTES) throw new HTTPException(413, { message: 'Keep document versions within 10 MB.' })
    const checksum = await digest(bytes), id = crypto.randomUUID()
    const objectKey = `organizations/${scope.organizationId}/rooms/${scope.roomId}/documents/${scope.documentId}/versions/${id}.json`
    const changeSummary = input.changeSummary == null ? null : text(input.changeSummary, 'Change summary', 500, true)
    signal?.throwIfAborted()
    await store().put(objectKey, payload)
    // Preserve unreferenced objects for reconciliation if the DB commit fails.
    try {
      signal?.throwIfAborted()
      return await db.$transaction(async (tx) => {
        signal?.throwIfAborted()
        await guardRoomWrite(tx, scope, actor.workToken)
        // A concurrent writer is detected by the unique version number or the head comparison.
        const version = await tx.documentVersion.create({ data: { id, ...scope, objectKey,
          versionNumber: (found.currentVersion?.versionNumber ?? 0) + 1, mimeType: 'application/json', sizeBytes: bytes.byteLength, checksum,
          ...(actor.agentId !== undefined ? { authorAgentId: actor.agentId } : { authorUserId: actor.userId }), changeSummary }, select: versionSelect })
        signal?.throwIfAborted()
        const updated = await tx.document.updateMany({ where: { id: scope.documentId, organizationId: scope.organizationId, roomId: scope.roomId, currentVersionId: found.currentVersionId }, data: { currentVersionId: id } })
        if (updated.count !== 1) throw new HTTPException(409, { message: 'A newer document version exists. Reload before saving.' })
        await tx.room.update({ where: { id: scope.roomId, organizationId: scope.organizationId }, data: { lastActivityAt: new Date() } })
        signal?.throwIfAborted()
        return version
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new HTTPException(409, { message: 'A newer document version exists. Reload before saving.' })
      throw error
    }
  }
  async function findCreation(scope: Omit<DocumentScope, 'documentId'>, raw: DocumentCreation, userId: string): Promise<CreationResult | null> {
    const parsed = (() => { try { return parseCreation(raw) } catch { throw new HTTPException(422, { message: 'Invalid document creation input.' }) } })()
    const receipt = await db.documentCreationReceipt.findUnique({ where: {
      organizationId_roomId_userId_requestId: { ...scope, userId, requestId: parsed.requestId },
    } })
    if (!receipt) return null
    const requestHash = await digest(new TextEncoder().encode(JSON.stringify(parsed)))
    if (receipt.requestHash !== requestHash) throw new HTTPException(409, { message: 'This creation request ID was already used with different content. Reuse the original input.' })
    return { documentId: receipt.documentId, versionId: receipt.versionId, versionNumber: receipt.versionNumber, requestId: parsed.requestId, saved: true, replayed: true }
  }
  async function createDocument(scope: Omit<DocumentScope, 'documentId'>, raw: DocumentCreation,
    actor: { agentId: string; workToken: string; userId: string; runId: string }, signal?: AbortSignal): Promise<CreationResult> {
    signal?.throwIfAborted()
    const parsed = (() => { try { return parseCreation(raw) } catch { throw new HTTPException(422, { message: 'Invalid document creation input.' }) } })()
    const requestHash = await digest(new TextEncoder().encode(JSON.stringify(parsed)))
    const key = { ...scope, userId: actor.userId, requestId: parsed.requestId }
    const where = { organizationId_roomId_userId_requestId: key }
    const replay = (receipt: { requestHash: string; documentId: string; versionId: string; versionNumber: number }): CreationResult => {
      if (receipt.requestHash !== requestHash) throw new HTTPException(409, { message: 'This creation request ID was already used with different content. Reuse the original input.' })
      return { documentId: receipt.documentId, versionId: receipt.versionId, versionNumber: receipt.versionNumber, requestId: parsed.requestId, saved: true, replayed: true }
    }
    // Identity and run ID are supplied by the authenticated coordinator, never the model.
    if (!actor.userId || !actor.runId) throw new HTTPException(403, { message: 'Creation requires an authenticated agent run.' })
    const documentId = crypto.randomUUID(), versionId = crypto.randomUUID()
    await checkActor({ ...scope, documentId }, { agentId: actor.agentId, workToken: actor.workToken })
    const existing = await db.documentCreationReceipt.findUnique({ where })
    if (existing) return replay(existing)
    const content = creationContent(parsed, documentId)
    const payload = JSON.stringify(content), bytes = new TextEncoder().encode(payload), checksum = await digest(bytes)
    const objectKey = `organizations/${scope.organizationId}/rooms/${scope.roomId}/documents/${documentId}/versions/${versionId}.json`
    signal?.throwIfAborted()
    await store().put(objectKey, payload)
    // Storage cannot join the DB transaction. Unreferenced objects are left for reconciliation.
    return db.$transaction(async (tx) => {
      signal?.throwIfAborted()
      // Serialize retries with all room writers, then recheck the durable receipt.
      await guardRoomWrite(tx, scope, actor.workToken)
      const existing = await tx.documentCreationReceipt.findUnique({ where })
      if (existing) return replay(existing)
      await tx.document.create({ data: { id: documentId, ...scope, title: parsed.title, category: parsed.category, kind: parsed.kind } })
      await tx.documentVersion.create({ data: { id: versionId, ...scope, documentId, versionNumber: 1,
        objectKey, mimeType: 'application/json', sizeBytes: bytes.byteLength, checksum,
        authorAgentId: actor.agentId, changeSummary: parsed.changeSummary } })
      await tx.document.update({ where: { id: documentId }, data: { currentVersionId: versionId } })
      await tx.documentCreationReceipt.create({ data: { ...key, requestHash, documentId, versionId, versionNumber: 1, agentId: actor.agentId, runId: actor.runId } })
      signal?.throwIfAborted()
      return { documentId, versionId, versionNumber: 1, requestId: parsed.requestId, saved: true, replayed: false }
    })
  }
  async function editDocument(scope: DocumentScope, input: { expectedVersionId: string | null; edits: DocumentEdit[] | SpreadsheetEdit[]; changeSummary?: string }, actor: DocumentActor, signal?: AbortSignal) {
    signal?.throwIfAborted()
    await checkActor(scope, actor)
    const saved = await readDocument(scope)
    if (saved.currentVersionId !== input.expectedVersionId) throw new HTTPException(409, { message: 'A newer document version exists. Reload before editing.' })
    if (!saved.content || typeof saved.content !== 'object' || !('format' in saved.content) || saved.content.format !== 'univer') {
      throw new HTTPException(422, { message: 'Open and save this document in the Univer editor before editing it with tools.' })
    }
    const response = await officeRequest(env, '/edit', JSON.stringify({ content: saved.content, edits: input.edits }), true, signal)
    const result = await response.json() as { content: unknown }
    const content = validateOfficeContent(saved.kind, result.content)
    let version
    try { version = await saveVersion(scope, { expectedVersionId: input.expectedVersionId, content, changeSummary: input.changeSummary }, actor, signal) }
    catch (error) {
      signal?.throwIfAborted()
      if (error instanceof HTTPException) {
        if (error.status === 409) throw new SkillOperationError('VERSION_CONFLICT', 'persistence', 'A newer document version exists. Read it again before editing.', true, 409)
        throw error
      }
      throw new SkillOperationError('PERSISTENCE_FAILED', 'persistence', 'The document save could not be confirmed. Read the current version before attempting another edit.', false, 502)
    }
    return { content, version }
  }
  return { readDocument, saveVersion, editDocument, createDocument, findCreation }
}
