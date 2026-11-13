import { expect, test } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import { createAgentInterface, createOfficeSkills, createRoomSkillBackend, type SkillBackend } from '../src/agent_interface'
import type { Database } from '../src/db'
import type { Bindings } from '../src/env'
import { documentEdits, spreadsheetEdits } from '../src/agent_interface/schemas'
import { SkillOperationError } from '../src/skill-operation-error'

const profile = { id: 'scout', name: 'Scout', role: 'Edit documents', rules: ['Be concise.'] }
const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 2, text: 2, reasoning: undefined } }
const finish = { usage, warnings: [], finishReason: { unified: 'tool-calls' as const, raw: undefined } }
const call = (toolName: string, input: unknown, toolCallId: string) => ({ ...finish, content: [{ type: 'tool-call' as const, toolName, toolCallId, input: JSON.stringify(input) }] })
const done = { ...finish, finishReason: { unified: 'stop' as const, raw: undefined }, content: [{ type: 'text' as const, text: 'Saved.' }] }
function harness() {
  let allowed = true
  const edits: unknown[] = []
  const reads: unknown[] = []
  const backend: SkillBackend = {
    authorize: async () => { if (!allowed) throw new Error('access revoked') },
    list: async () => [{ id: 'doc-1', kind: 'DOCUMENT' }],
    read: async (...args) => { reads.push(args.slice(0, 3)); return { currentVersionId: 'v1', kind: 'DOCUMENT', result: { body: { dataStream: 'Hello\r\n' } } } },
    edit: async (...args) => { edits.push(args.slice(0, 5)); return { documentId: args[0], versionId: 'v2' } },
  }
  return { backend, edits, reads, revoke: () => { allowed = false } }
}
const edit = { documentId: 'doc-1', expectedVersionId: 'v1', changeSummary: 'Update greeting', edits: [{ type: 'replaceText', start: 0, end: 5, expectedText: 'Hello', text: 'Welcome' }] }

test('AI SDK routes model function calls to the associated skill and returns results to the model', async () => {
  const h = harness()
  const model = new MockLanguageModelV4({ doGenerate: [call('readDocument', { documentId: 'doc-1' }, 'read'), call('applyDocumentEdits', edit, 'edit'), done] })
  const result = await createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Update the greeting.' })
  expect(result.text).toBe('Saved.')
  expect(h.reads).toEqual([['doc-1', 'readDocument', {}]])
  expect(h.edits).toEqual([['doc-1', 'v1', 'DOCUMENT', edit.edits, 'Update greeting']])
  expect(model.doGenerateCalls).toHaveLength(3)
  expect(model.doGenerateCalls[0].prompt[0].content).toContain('Skill documents:')
  expect(model.doGenerateCalls[0].tools?.map((t) => t.name)).toContain('readRange')
  expect(JSON.stringify(model.doGenerateCalls[2].prompt)).toContain('v2')
})

test('an edit without a successful read does not reach the backend', async () => {
  const h = harness()
  const model = new MockLanguageModelV4({ doGenerate: [call('applyDocumentEdits', edit, 'edit'), done] })
  await createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Edit' })
  expect(h.edits).toHaveLength(0)
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('Read this document')
})

test('SDK validation rejects model-supplied identity before executing a skill', async () => {
  const h = harness()
  const model = new MockLanguageModelV4({ doGenerate: [call('readDocument', { documentId: 'doc-1', organizationId: 'other-org' }, 'read'), done] })
  await createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Read' })
  expect(h.reads).toHaveLength(0)
})

test('revoked access and cancellation block tool execution', async () => {
  for (const cancelled of [false, true]) {
    const h = harness(), controller = new AbortController()
    if (cancelled) controller.abort(); else h.revoke()
    const model = new MockLanguageModelV4({ doGenerate: [call('readDocument', { documentId: 'doc-1' }, 'read'), done] })
    await createAgentInterface(profile, model, createOfficeSkills(h.backend, controller.signal)).generate({ prompt: 'Read' })
    expect(h.reads).toHaveLength(0)
  }
})

test('an already applied version cannot be written twice in one run', async () => {
  const h = harness()
  const model = new MockLanguageModelV4({ doGenerate: [call('readDocument', { documentId: 'doc-1' }, 'read'), call('applyDocumentEdits', edit, 'edit1'), call('applyDocumentEdits', edit, 'edit2'), done] })
  await createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Edit' })
  expect(h.edits).toHaveLength(1)
})

test('native table calls reach the versioned backend and capability discovery does not grant write evidence', async () => {
  const h = harness()
  const table = { documentId: 'doc-1', expectedVersionId: 'v1', changeSummary: 'Add whale table', edits: [{ type: 'insertTable', index: 5, cells: [['Whale', 'Approximate length'], ['Blue whale', '24–30 m']], headerRow: true }] }
  const model = new MockLanguageModelV4({ doGenerate: [
    call('getDocumentCapabilities', { documentId: 'doc-1' }, 'capabilities'),
    call('applyDocumentEdits', table, 'before-read'),
    call('readDocument', { documentId: 'doc-1' }, 'read'),
    call('applyDocumentEdits', table, 'native-table'), done,
  ] })
  await createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Add a whale size comparison table.' })
  expect(h.edits).toHaveLength(1)
  expect(h.edits[0]).toEqual(['doc-1', 'v1', 'DOCUMENT', table.edits, 'Add whale table'])
  expect(JSON.stringify(model.doGenerateCalls[2].prompt)).toContain('Read this document')
})

test('an unchanged rejected edit is blocked after rereading but a corrected edit may execute', async () => {
  const h = harness()
  let attempts = 0
  h.backend.edit = async () => { attempts++; throw new SkillOperationError('REVIEW_REJECTED', 'review', 'Outside requested scope.') }
  const corrected = { ...edit, edits: [{ ...edit.edits[0], text: 'Hi' }] }
  const model = new MockLanguageModelV4({ doGenerate: [
    call('readDocument', { documentId: 'doc-1' }, 'r1'), call('applyDocumentEdits', edit, 'first'),
    call('readDocument', { documentId: 'doc-1' }, 'r2'), call('applyDocumentEdits', edit, 'repeat'),
    call('applyDocumentEdits', corrected, 'corrected'), done,
  ] })
  await createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Edit the greeting.' })
  expect(attempts).toBe(2)
  expect(JSON.stringify(model.doGenerateCalls[4].prompt)).toContain('EDIT_ALREADY_REJECTED')
})

test('skill schemas reject unknown edits and malformed spreadsheet values', () => {
  expect(documentEdits.safeParse([{ type: 'executeCode', code: 'bad' }]).success).toBe(false)
  expect(spreadsheetEdits.safeParse([{ type: 'setFormulas', sheetId: 's1', row: 0, column: 0, rows: 1, columns: 1, formulas: [['not a formula']] }]).success).toBe(false)
})

test('room skill document discovery uses only the trusted room and organization', async () => {
  const lookups: unknown[] = []
  const db = { document: { findMany: async (query: unknown) => { lookups.push(query); return [] } } } as unknown as Database
  const backend = createRoomSkillBackend({} as Bindings, { userId: 'u1', organizationId: 'o1', roomId: 'r1', sessionId: 'session-1' }, 'a1', async (action) => action(db), 'lease-1')
  await backend.list()
  expect(lookups).toEqual([{ where: { organizationId: 'o1', roomId: 'r1' }, select: { id: true, title: true, kind: true, currentVersionId: true }, orderBy: { id: 'asc' }, take: 101 }])
})

test('spreadsheet function calls use the spreadsheet skill and versioned edit backend', async () => {
  const h = harness()
  h.backend.read = async () => ({ currentVersionId: 'v1', kind: 'SPREADSHEET', result: { cells: [[{ v: 1 }]] } })
  const input = { documentId: 'book-1', expectedVersionId: 'v1', changeSummary: 'Update total', edits: [{ type: 'setCells', sheetId: 's1', row: 0, column: 0, rows: 1, columns: 1, values: [[42]] }] }
  const model = new MockLanguageModelV4({ doGenerate: [
    call('readRange', { documentId: 'book-1', sheetId: 's1', row: 0, column: 0, rows: 1, columns: 1 }, 'read'),
    call('applySpreadsheetEdits', input, 'edit'), done,
  ] })
  await createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Update total' })
  expect(h.edits).toEqual([['book-1', 'v1', 'SPREADSHEET', input.edits, 'Update total']])
})

test('skill errors redact backend details before returning tool results to the model', async () => {
  const h = harness()
  h.backend.read = async () => { throw new Error('postgres://SECRET_DATABASE_CREDENTIALS/internal') }
  const model = new MockLanguageModelV4({ doGenerate: [call('readDocument', { documentId: 'doc-1' }, 'read'), done] })
  await createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Read' })
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).not.toContain('SECRET_DATABASE_CREDENTIALS')
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('The skill could not complete')
})


test('document discovery follows pages past 100 and scopes title searches', async () => {
  const documents = Array.from({ length: 205 }, (_, i) => ({ id: `doc-${String(i).padStart(3, '0')}` }))
  type Query = { where: { id?: { gt: string }; organizationId: string; roomId: string; title?: { contains: string; mode: string } }; take: number }
  const queries: Query[] = []
  const db = { document: { findMany: async (query: Query) => {
    queries.push(query)
    return documents.filter((doc) => !query.where.id || doc.id > query.where.id.gt).slice(0, query.take)
  } } } as unknown as Database
  const backend = createRoomSkillBackend({} as Bindings, { userId: 'u1', organizationId: 'o1', roomId: 'r1', sessionId: 's1' }, 'a1', async (action) => action(db), 'lease-1')
  const found: string[] = []
  let after: string | undefined
  do {
    const page = await backend.list({ after, title: 'Budget' }) as { documents: { id: string }[]; nextCursor: string | null }
    found.push(...page.documents.map((doc) => doc.id))
    after = page.nextCursor ?? undefined
  } while (after)
  expect(found).toEqual(documents.map((doc) => doc.id))
  expect(queries).toHaveLength(3)
  for (const query of queries) expect(query.where).toMatchObject({ organizationId: 'o1', roomId: 'r1', title: { contains: 'Budget', mode: 'insensitive' } })
})

test('SDK cancellation reaches an edit already in progress', async () => {
  const h = harness(), controller = new AbortController()
  let started!: () => void
  const editing = new Promise<void>((resolve) => { started = resolve })
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  h.backend.edit = async (_id, _version, _kind, _edits, _summary, signal) => {
    started()
    await pending
    signal!.throwIfAborted()
    h.edits.push('saved')
    return {}
  }
  const model = new MockLanguageModelV4({ doGenerate: [call('readDocument', { documentId: 'doc-1' }, 'read'), call('applyDocumentEdits', edit, 'edit'), done] })
  const generation = createAgentInterface(profile, model, createOfficeSkills(h.backend, new AbortController().signal)).generate({ prompt: 'Edit', abortSignal: controller.signal })
  const cancelled = generation.then(() => false, () => true)
  await editing
  controller.abort()
  release()
  expect(await cancelled).toBe(true)
  expect(h.edits).toHaveLength(0)
})
