import { expect, test } from 'bun:test'
import { createDocumentService } from '../src/documents/document-service'
import { creationContent, parseCreation, type DocumentCreation } from '../src/documents/creation'
import type { Database } from '../src/db'
import type { Bindings } from '../src/env'

const input: DocumentCreation = { kind: 'DOCUMENT', requestId: '00000000-0000-4000-8000-000000000001', title: 'Brief', category: 'Notes', changeSummary: 'Create brief', paragraphs: [{ text: 'Hello 🌊', style: { bold: true } }, { text: 'World' }] }
const scope = { organizationId: 'org', roomId: 'room' }
const actor = { agentId: 'agent', userId: 'user', runId: 'run', workToken: 'lease' }
function harness() {
  let state = { documents: [] as Record<string, unknown>[], versions: [] as Record<string, unknown>[], receipts: [] as Record<string, unknown>[] }
  let locked = true, assigned = true, failReceipt = false, failUpload = false
  let queue = Promise.resolve()
  const objects = new Map<string, string>()
  const find = (where: { organizationId_roomId_userId_requestId: Record<string, unknown> }) => state.receipts.find((receipt) => Object.entries(where.organizationId_roomId_userId_requestId).every(([key, value]) => receipt[key] === value)) ?? null
  const tx = {
    room: { updateMany: async () => ({ count: locked ? 1 : 0 }) },
    document: {
      create: async ({ data }: { data: Record<string, unknown> }) => { state.documents.push(data); return data },
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(state.documents.find((doc) => doc.id === where.id)!, data),
    },
    documentVersion: { create: async ({ data }: { data: Record<string, unknown> }) => { state.versions.push(data); return data } },
    documentCreationReceipt: {
      findUnique: async ({ where }: { where: Parameters<typeof find>[0] }) => find(where),
      create: async ({ data }: { data: Record<string, unknown> }) => { if (failReceipt) throw new Error('DB failure'); state.receipts.push(data); return data },
    },
  }
  const db = { ...tx, roomAgent: { findFirst: async () => assigned ? { agentId: actor.agentId } : null },
    $transaction: (action: (client: typeof tx) => Promise<unknown>) => {
      const next = queue.then(async () => {
        const before = structuredClone(state)
        try { return await action(tx) } catch (error) { state = before; throw error }
      })
      queue = next.then(() => {}, () => {})
      return next
    },
  } as unknown as Database
  const service = () => createDocumentService(db, {} as Bindings, { get: async (key) => objects.get(key)!, put: async (key, body) => { if (failUpload) throw new Error('Storage failure'); objects.set(key, body) } })
  return { service, objects, state: () => state, lock: (value: boolean) => { locked = value }, assign: (value: boolean) => { assigned = value }, failReceipt: (value: boolean) => { failReceipt = value }, failUpload: (value: boolean) => { failUpload = value } }
}

test('creation commits content, first version, attribution and durable receipt together', async () => {
  const h = harness(), result = await h.service().createDocument(scope, input, actor)
  expect(result).toMatchObject({ saved: true, versionNumber: 1, replayed: false })
  expect(h.state().documents[0]).toMatchObject({ ...scope, currentVersionId: result.versionId, title: input.title })
  expect(h.state().versions[0]).toMatchObject({ documentId: result.documentId, authorAgentId: actor.agentId, versionNumber: 1 })
  expect(h.state().receipts[0]).toMatchObject({ ...scope, userId: actor.userId, runId: actor.runId, requestId: input.requestId })
  const snapshot = JSON.parse([...h.objects.values()][0]).snapshot
  expect(snapshot.body.dataStream).toBe('Hello 🌊\rWorld\r\n')
  expect(snapshot.body.paragraphs.map((p: { startIndex: number }) => p.startIndex)).toEqual([8, 14])
  expect(snapshot.body.textRuns[0]).toMatchObject({ st: 0, ed: 8, ts: { bl: 1 } })
})

test('concurrent attempts and retries from a new service/run return one durable creation', async () => {
  const h = harness()
  const results = await Promise.all([h.service().createDocument(scope, input, actor), h.service().createDocument(scope, input, actor)])
  expect(results[0].documentId).toBe(results[1].documentId)
  expect(h.state().documents).toHaveLength(1)
  expect(h.state().versions).toHaveLength(1)
  const retry = await h.service().createDocument(scope, input, { ...actor, runId: 'later-run' })
  expect(retry).toMatchObject({ ...results[0], replayed: true })
  await expect(h.service().createDocument(scope, { ...input, title: 'Different' }, actor)).rejects.toThrow('different content')
  expect(h.state().documents).toHaveLength(1)
  expect(await h.service().findCreation(scope, input, actor.userId)).toEqual(retry)
  expect(await h.service().findCreation(scope, input, 'unknown-user')).toBeNull()
  await expect(h.service().findCreation(scope, { ...input, title: 'Changed' }, actor.userId)).rejects.toThrow('different content')
})

test('retry keys are scoped to user and room, and replay still checks agent assignment', async () => {
  const h = harness()
  await h.service().createDocument(scope, input, actor)
  await h.service().createDocument({ ...scope, roomId: 'other-room' }, input, actor)
  await h.service().createDocument(scope, input, { ...actor, userId: 'other-user' })
  expect(h.state().documents).toHaveLength(3)
  h.assign(false)
  await expect(h.service().createDocument(scope, input, actor)).rejects.toThrow('assigned')
})

test('lease loss, storage failure, receipt failure and cancellation never leave partial DB creation', async () => {
  const h = harness()
  h.lock(false)
  await expect(h.service().createDocument(scope, input, actor)).rejects.toThrow('no longer owns')
  h.lock(true); h.failUpload(true)
  await expect(h.service().createDocument(scope, input, actor)).rejects.toThrow('Storage failure')
  h.failUpload(false); h.failReceipt(true)
  await expect(h.service().createDocument(scope, input, actor)).rejects.toThrow('DB failure')
  expect(h.state()).toEqual({ documents: [], versions: [], receipts: [] })
  h.failReceipt(false)
  await expect(h.service().createDocument(scope, input, actor, AbortSignal.abort())).rejects.toThrow()
  expect(h.state().documents).toHaveLength(0)
  expect((await h.service().createDocument(scope, input, actor)).saved).toBe(true)
})

test('spreadsheet creation preserves literals, formulas and dimensions; invalid input is rejected', () => {
  const workbook: DocumentCreation = { kind: 'SPREADSHEET', requestId: input.requestId, title: 'Budget', category: 'Notes', changeSummary: 'Create budget', sheets: [{ name: 'Budget', cells: [
    { row: 0, column: 0, value: '=literal' }, { row: 0, column: 1, value: '00123' },
    { row: 0, column: 26, formula: '=1+1', style: { bold: true } }, { row: 2, column: 0, value: false },
  ] }] }
  const snapshot = creationContent(parseCreation(workbook), 'workbook').snapshot as { sheets: Record<string, { columnCount: number; cellData: Record<string, Record<string, unknown>> }> }
  expect(snapshot.sheets['sheet-1'].columnCount).toBe(27)
  expect(snapshot.sheets['sheet-1'].cellData[0][0]).toEqual({ v: '=literal', t: 1 })
  expect(snapshot.sheets['sheet-1'].cellData[0][1]).toEqual({ v: '00123', t: 1 })
  expect(snapshot.sheets['sheet-1'].cellData[0][26]).toEqual({ f: '=1+1', s: { bl: 1 } })
  for (const sheets of [
    [{ name: 'X', columns: 1, cells: [{ row: 0, column: 1, value: 1 }] }],
    [{ name: 'X', cells: [{ row: 0, column: 0, value: 1, formula: '=1' }] }],
    [{ name: 'X', cells: [{ row: 0, column: 0 }, { row: 0, column: 0 }] }],
    [{ name: 'X', cells: [] }, { name: 'x', cells: [] }],
  ]) expect(() => parseCreation({ ...workbook, sheets })).toThrow()
  expect(() => parseCreation({ ...input, paragraphs: [{ text: '\u0000' }] })).toThrow()
})
