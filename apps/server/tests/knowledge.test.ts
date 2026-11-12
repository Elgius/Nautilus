import { expect, test, spyOn } from 'bun:test'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'
import type { Bindings } from '../src/env'
import { createAgentModel } from '../src/ai'
import { REFRESH_MS, sourceAccess, entryIsCurrent, tagInput, type Source } from '../src/knowledge/service'
import { documentChunks, textChunks, validateFindings } from '../src/knowledge/content'
import { generateFindings } from '../src/knowledge/generate'

const source = (scope: 'PERSONAL' | 'ORGANIZATION' = 'PERSONAL') => ({
  organizationId: 'org', roomId: 'room', taggedByUserId: 'tagger', revokedAt: null, revision: 3,
  lastProcessedRevision: 3, lastProcessedVersionId: 'v1', document: { id: 'doc', currentVersionId: 'v1' }, message: null,
  base: { scope, ownerUserId: scope === 'PERSONAL' ? 'owner' : null },
} as Source)

test('six-hour cadence and exact-source tags reject inferred grants and identity injection', () => {
  expect(REFRESH_MS).toBe(21_600_000)
  const roomId = crypto.randomUUID(), documentId = crypto.randomUUID(), messageId = crypto.randomUUID()
  expect(tagInput.safeParse({ scope: 'PERSONAL', roomId, documentId }).success).toBe(true)
  for (const patch of [{ documentId, messageId }, {}, { documentId, userId: 'other' }, { documentId, agentId: 'other' }, { documentId, scope: 'public' }]) {
    expect(tagInput.safeParse({ scope: 'PERSONAL', roomId, ...patch }).success).toBe(false)
  }
})

test('personal access uses its owner; shared grants require live sharing authority and room access', async () => {
  let member: { role: string } | null = { role: 'member' }, roomMember: { role: string } | null = { role: 'MEMBER' }
  const users: string[] = []
  const db = { member: { findUnique: async ({ where }: { where: { organizationId_userId: { userId: string } } }) => { users.push(where.organizationId_userId.userId); return member } }, roomMember: { findFirst: async () => roomMember } } as unknown as Database
  expect(await sourceAccess(db, source())).toBe(true); expect(users.at(-1)).toBe('owner')
  expect(await sourceAccess(db, source('ORGANIZATION'))).toBe(false); expect(users.at(-1)).toBe('tagger')
  roomMember = { role: 'OWNER' }; expect(await sourceAccess(db, source('ORGANIZATION'))).toBe(true)
  roomMember = { role: 'MEMBER' }; member = { role: 'admin' }; expect(await sourceAccess(db, source('ORGANIZATION'))).toBe(true)
  roomMember = null; expect(await sourceAccess(db, source('ORGANIZATION'))).toBe(false)
  member = null; expect(await sourceAccess(db, source())).toBe(false)
  expect(await sourceAccess(db, { ...source(), revokedAt: new Date() })).toBe(false)
})

test('stale source revisions and document heads are excluded from retrieval', () => {
  const s = source()
  expect(entryIsCurrent(s, { sourceRevision: 3 })).toBe(true)
  expect(entryIsCurrent(s, { sourceRevision: 2 })).toBe(false)
  expect(entryIsCurrent({ ...s, lastProcessedRevision: 2 }, { sourceRevision: 3 })).toBe(false)
  expect(entryIsCurrent({ ...s, document: { ...s.document!, currentVersionId: 'v2' } }, { sourceRevision: 3 })).toBe(false)
})

test('saved documents are fully chunked with positions, without snapshot resources or style data', () => {
  const text = 'a'.repeat(35_000)
  const chunks = documentChunks({ format: 'univer', kind: 'DOCUMENT', snapshot: { body: { dataStream: text }, resources: [{ secret: 'not-source-text' }], headers: { header: { body: { dataStream: 'Header' } } } } })
  expect(chunks.slice(0, 3).map((c) => c.text).join('')).toBe(text)
  expect(chunks[2].locator).toContain('32000–35000')
  expect(chunks[3].text).toBe('Header')
  expect(JSON.stringify(chunks)).not.toContain('not-source-text')
  expect(documentChunks({ format: 'markdown', text })).toEqual(textChunks(text, 'Document body'))
  expect(() => documentChunks({ format: 'unknown' })).toThrow()
})

test('spreadsheet evidence retains sheet/cell addresses and identifies saved formula values', () => {
  const chunks = documentChunks({ format: 'univer', kind: 'SPREADSHEET', snapshot: { sheetOrder: ['s'], sheets: { s: { name: 'Budget', cellData: { 0: { 0: { v: 'Cost' }, 26: { v: 42, f: '=SUM(A2:A3)' } }, 1: { 1: { p: { body: { dataStream: 'Approved' } } }, 2: { f: '=A1' } } } } } } })
  expect(chunks[0].locator).toContain('Budget (s)')
  expect(chunks[0].text).toContain('AA1: 42 [formula =SUM(A2:A3); saved value, not recalculated]')
  expect(chunks[0].text).toContain('B2: Approved')
  expect(chunks[0].text).toContain('C2: formula =A1 (no saved calculated value)')
})

test('findings require evidence present in the exact tagged chunk', () => {
  const chunk = { locator: 'body 0–20', text: 'Launch is planned.' }
  const finding = { category: 'Progress', title: 'Launch', body: 'Launch is planned.', evidence: 'Launch is planned.' }
  expect(validateFindings({ findings: [finding] }, chunk)[0].locator).toBe(chunk.locator)
  expect(() => validateFindings({ findings: [{ ...finding, evidence: 'Launch is complete.' }] }, chunk)).toThrow('matching source evidence')
})

test('generation is stateless, structured, tool-free, and receives only the explicitly supplied chunk', async () => {
  let request: Record<string, unknown> = {}
  const output = { findings: [{ category: 'Decision', title: 'Release', body: 'Release approved.', evidence: 'Release approved.' }] }
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    request = JSON.parse(String(init?.body))
    return Response.json({ id: 'resp_test', model: 'gpt-test', created_at: 1, status: 'completed', usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      output: [{ type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
    })
  }, { preconnect: globalThis.fetch.preconnect }))
  try {
    const chunk = { locator: 'Message tagged-id', text: 'Release approved.' }
    const findings = await generateFindings(chunk, createAgentModel({ OPENAI_API_KEY: 'test', LLM_MODEL: 'gpt-test' } as Bindings))
    expect(findings).toHaveLength(1)
    expect(request).toMatchObject({ store: false, text: { format: { type: 'json_schema', strict: true, name: 'knowledge_findings' } } })
    expect(request).not.toHaveProperty('previous_response_id')
    expect(request.tools ?? []).toHaveLength(0)
    const input = request.input as { role: string; content: unknown }[]
    expect(input.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(JSON.stringify(input)).toContain('Release approved.')
  } finally { fetch.mockRestore() }
})

test('knowledge routes reject invalid scopes, cursors, oversized payloads and owner overrides before DB access', async () => {
  const { Hono } = await import('hono')
  const { knowledgeRoutes } = await import('../src/knowledge/routes')
  const { HTTPException } = await import('hono/http-exception')
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => { c.set('organizationId', 'org'); c.set('db', {} as Database); c.set('session', { user: { id: 'user' } } as AppEnv['Variables']['session']); await next() })
  app.route('/', knowledgeRoutes)
  app.onError((error, c) => c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500))
  expect((await app.request('/?scope=public')).status).toBe(400)
  expect((await app.request('/?scope=PERSONAL&cursor=bad')).status).toBe(400)
  expect((await app.request('/sources/id/history?scope=PERSONAL&before=999999999999')).status).toBe(400)
  expect((await app.request('/sources', { method: 'POST', body: 'not-json', headers: { 'Content-Type': 'application/json' } })).status).toBe(400)
  expect((await app.request('/sources', { method: 'POST', body: JSON.stringify({ scope: 'PERSONAL', roomId: crypto.randomUUID(), documentId: crypto.randomUUID(), ownerUserId: 'other' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(400)
  expect((await app.request('/sources', { method: 'POST', body: 'x'.repeat(5000), headers: { 'Content-Type': 'application/json' } })).status).toBe(413)
})
