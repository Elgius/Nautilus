import { expect, spyOn, test } from 'bun:test'
import { createDocumentService } from '../src/documents/document-service'
import type { Database } from '../src/db'
import type { Bindings } from '../src/env'

const scope = { organizationId: 'org-1', roomId: 'room-1', documentId: 'doc-1' }
const content = { format: 'univer' as const, kind: 'DOCUMENT' as const, snapshot: {
  id: 'doc-1', body: { dataStream: 'Hello\r\n', paragraphs: [{ startIndex: 5, paragraphId: 'p1' }] }, documentStyle: {},
} }

async function harness(options: { assigned?: boolean; found?: boolean; changed?: boolean; corrupt?: boolean; duplicate?: boolean } = {}) {
  const payload = JSON.stringify(content), bytes = new TextEncoder().encode(payload)
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((value) => value.toString(16).padStart(2, '0')).join('')
  const lookups: unknown[] = [], versions: Record<string, unknown>[] = [], writes: { key: string; body: string }[] = []
  const found = { id: scope.documentId, kind: 'DOCUMENT', currentVersionId: 'v1', currentVersion: {
    objectKey: 'saved.json', checksum, sizeBytes: bytes.byteLength, versionNumber: 1,
  } }
  const tx = {
    documentVersion: { create: async (input: { data: Record<string, unknown> }) => {
      if (options.duplicate) throw { code: 'P2002' }
      versions.push(input.data)
      return { id: input.data.id, versionNumber: 2 }
    } },
    document: { updateMany: async () => ({ count: options.changed ? 0 : 1 }) },
    room: { update: async () => ({}) },
  }
  const db = {
    document: { findFirst: async (query: unknown) => { lookups.push(query); return options.found === false ? null : found } },
    roomAgent: { findFirst: async (query: unknown) => { lookups.push(query); return options.assigned === false ? null : { agentId: 'agent-1' } } },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx),
  } as unknown as Database
  const env = { OFFICE_SERVICE_URL: 'https://office.internal', OFFICE_SERVICE_TOKEN: 'x'.repeat(32) } as Bindings
  const service = createDocumentService(db, env, {
    get: async () => options.corrupt ? 'tampered' : payload,
    put: async (key, body) => { writes.push({ key, body }) },
  })
  return { service, lookups, versions, writes }
}

test('shared reads scope the document to its organization and room and check storage integrity', async () => {
  const { service, lookups } = await harness()
  expect(await service.readDocument(scope)).toEqual({ content, currentVersionId: 'v1', kind: 'DOCUMENT' })
  expect(lookups[0]).toMatchObject({ where: { id: 'doc-1', organizationId: 'org-1', roomId: 'room-1' } })
  const missing = await harness({ found: false })
  await expect(missing.service.readDocument(scope)).rejects.toThrow('Document not found')
  const corrupt = await harness({ corrupt: true })
  await expect(corrupt.service.readDocument(scope)).rejects.toThrow('integrity check')
})

test('shared saves preserve version metadata, trusted actor attribution and storage scope', async () => {
  const { service, versions, writes } = await harness()
  await service.saveVersion(scope, { content, expectedVersionId: 'v1', changeSummary: 'Updated brief' }, { agentId: 'agent-1' })
  expect(versions[0]).toMatchObject({ ...scope, versionNumber: 2, authorAgentId: 'agent-1', changeSummary: 'Updated brief', mimeType: 'application/json' })
  expect(versions[0].authorUserId).toBeUndefined()
  expect(writes[0].key).toStartWith('organizations/org-1/rooms/room-1/documents/doc-1/versions/')
  expect(JSON.parse(writes[0].body)).toEqual(content)
})

test('stale versions and unassigned agents are rejected before uploading any content', async () => {
  const stale = await harness()
  await expect(stale.service.saveVersion(scope, { content, expectedVersionId: 'old' }, { userId: 'user-1' })).rejects.toThrow('newer document version')
  expect(stale.writes).toHaveLength(0)
  const unassigned = await harness({ assigned: false })
  await expect(unassigned.service.editDocument(scope, { expectedVersionId: 'v1', edits: [] }, { agentId: 'agent-1' })).rejects.toThrow('assigned to this room')
  expect(unassigned.writes).toHaveLength(0)
})

test('both concurrent version-number collisions and head changes surface as conflicts', async () => {
  for (const options of [{ duplicate: true }, { changed: true }]) {
    const { service } = await harness(options)
    await expect(service.saveVersion(scope, { content, expectedVersionId: 'v1' }, { userId: 'user-1' })).rejects.toMatchObject({ status: 409 })
  }
})

test('document edit service calls private editing transport then saves one validated version', async () => {
  const { service, versions } = await harness()
  const edited = structuredClone(content)
  edited.snapshot.body.dataStream = 'World\r\n'
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ content: edited })))
  try {
    const result = await service.editDocument(scope, { expectedVersionId: 'v1', edits: [
      { type: 'replaceText', start: 0, end: 5, expectedText: 'Hello', text: 'World' },
    ] }, { agentId: 'agent-1' })
    expect(fetch.mock.calls[0][0]).toBe('https://office.internal/edit')
    expect(result.content).toEqual(edited)
    expect(versions).toHaveLength(1)
  } finally { fetch.mockRestore() }
})
