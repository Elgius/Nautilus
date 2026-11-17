import { expect, test } from 'bun:test'
import { buildHubCitations } from '../../../shared/agent-citations'
import { sourceForRead } from '../src/agent-hub/read-sources'
import { mergeHubProvenance, MAX_HUB_SOURCES } from '../src/agent-hub/provenance'
import { completeHubSkills, withHubReadSources } from '../src/agent-hub/runtime'
import { tool } from 'ai'
import { z } from 'zod'
import type { HubSource, PrivateAgentJob } from '../../../shared/room-chat'
import type { AgentRunContext } from '../src/private-room-agents'
import type { Database } from '../src/db'
const source: HubSource = { id: 'approved-plan', title: 'Launch plan', scope: 'ORGANIZATION', body: 'Launch approved.', roomId: 'room', documentId: 'doc', messageId: null, updatedAt: '', revision: 3,
  citations: [{ quote: 'Launch approved by the team.', locator: 'Document body; UTF-16 0–28', documentVersionId: 'v3' }] }

test('response JSON resolves explicit markers into numbered, verified citations', () => {
  const text = '[Plan](#source-approved-plan) says launch is approved. [Again](#source-approved-plan). [Invented](#source-missing).'
  expect(buildHubCitations(text, [source])).toEqual([{ id: 'citation-1', number: 1, sourceId: 'approved-plan', sourceType: 'knowledge', title: 'Launch plan', scope: 'ORGANIZATION',
    url: '/room-id=room?document=doc', quote: 'Launch approved by the team.', locator: 'Document body; UTF-16 0–28', documentVersionId: 'v3', revision: 3 }])
  expect(buildHubCitations(text, [])).toEqual([])
})

test('code examples, incomplete markers and unrelated retrieved sources are not response citations', () => {
  expect(buildHubCitations('```md\n[Example](#source-approved-plan)\n```\n`[Example](#source-approved-plan)`\n[Incomplete](#source-approved-', [source])).toEqual([])
  expect(buildHubCitations('Hello', [source])).toEqual([])
})

const identity = { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'session' }
test('document and spreadsheet reads preserve version and distinguish evidence locations', () => {
  const titles = new Map([['doc', 'Budget']])
  const read = sourceForRead('readDocument', { documentId: 'doc' }, { currentVersionId: 'v2', result: { body: { dataStream: 'Approved budget: $500' } } }, identity, titles)[0]
  expect(read).toMatchObject({ title: 'Budget', kind: 'document', citations: [{ quote: 'Approved budget: $500', documentVersionId: 'v2' }] })
  const range = (row: number) => sourceForRead('readRange', { documentId: 'doc', sheetId: 'sheet', row, column: 0, rows: 1, columns: 1 }, { currentVersionId: 'v2', result: { cells: [[{ v: 500 }]] } }, identity, titles)[0]
  expect(range(0).id).not.toBe(range(1).id)
  expect(range(0).citations[0].locator).toContain('row 0, column 0')
  expect(sourceForRead('findText', { documentId: 'doc', text: 'Not found' }, { currentVersionId: 'v2', result: [] }, identity, titles)).toEqual([])
})

test('successful task reads supply source markers and structured response evidence', async () => {
  const sources: HubSource[] = []
  const run: AgentRunContext = { id: 'run', token: 'token', activity: async () => {}, committed: async () => {}, checkpoint: async () => {}, sources: async (incoming) => { sources.push(...incoming) } }
  const skills = completeHubSkills([{ id: 'planner', instructions: '', tools: { readTask: tool({ inputSchema: z.object({ taskId: z.string() }), execute: async () => ({ id: 'task', title: 'Review plan', description: 'Review launch', status: 'In review', date: '2026-11-19', revision: 2 }) }) } }], run, identity, async (action) => action({} as Database), new AbortController().signal)
  const execute = skills[0].tools.readTask.execute! as unknown as (input: unknown, options: { toolCallId: string; messages: never[] }) => Promise<{ citationSources: { id: string; marker: string }[] }>
  const result = await execute({ taskId: 'task' }, { toolCallId: 'read', messages: [] })
  expect(sources).toHaveLength(1)
  expect(result.citationSources[0].marker).toContain('#source-task-task-2')
  expect(buildHubCitations(result.citationSources[0].marker, sources)[0]).toMatchObject({ sourceType: 'task', url: '/kanban?task=task', revision: 2, title: 'Review plan' })
})


test('table citation IDs retain the full read window and cannot overwrite another window', () => {
  const read = (row: number, column: number, rows: number, columns: number) => sourceForRead('readTable', { documentId: 'doc', tableId: 'table', row, column, rows, columns }, { currentVersionId: 'v1', result: { cells: [[row === 0 ? 'First evidence' : 'Second evidence']] } }, identity, new Map())[0]
  const first = read(0, 0, 1, 1), second = read(1, 0, 1, 1)
  expect(new Set([first.id, second.id, read(0, 1, 1, 1).id, read(0, 0, 2, 1).id, read(0, 0, 1, 2).id]).size).toBe(5)
  expect(read(0, 0, 1, 1).id).toBe(first.id)
  const citations = buildHubCitations(`[First](#source-${first.id}) [Second](#source-${second.id})`, [first, second])
  expect(citations.map((citation) => citation.quote)).toEqual(['[["First evidence"]]', '[["Second evidence"]]'])
  expect(citations[1].locator).toContain('row 1, column 0')
})

test('exceeding evidence limits rejects the new read without dropping existing citations', () => {
  const job = { reply: `[Plan](#source-${source.id})`, sources: [source] } as PrivateAgentJob
  const incoming = Array.from({ length: MAX_HUB_SOURCES }, (_, index) => ({ ...source, id: `doc-${index}`, kind: 'document' as const, scope: 'ROOM' as const }))
  expect(() => mergeHubProvenance(job, incoming)).toThrow('Too many sources')
  expect(job.sources).toEqual([source])
  expect(buildHubCitations(job.reply, job.sources!)).toHaveLength(1)
})

test('specialist provenance decorates only assigned tools and records successful scoped reads', async () => {
  const recorded: HubSource[] = []
  const scoped = [{ id: 'specialist', instructions: 'Read assigned document only.', tools: { readDocument: tool({ inputSchema: z.object({ documentId: z.string() }), execute: async ({ documentId }) => {
    if (documentId !== 'assigned') throw new Error('Document outside assignment')
    return { currentVersionId: 'v1', result: { title: 'Assigned plan', body: { dataStream: 'Specialist evidence' } } }
  } }) } }]
  const skills = withHubReadSources(scoped, identity, async (sources) => { recorded.push(...sources) })
  expect(Object.keys(skills[0].tools)).toEqual(['readDocument'])
  const execute = skills[0].tools.readDocument.execute! as unknown as (input: unknown, options: { toolCallId: string; messages: never[] }) => Promise<{ citationSources: { marker: string }[] }>
  const options = { toolCallId: 'specialist-read', messages: [] as never[] }
  await expect(execute({ documentId: 'unassigned' }, options)).rejects.toThrow('outside assignment')
  expect(recorded).toEqual([])
  const result = await execute({ documentId: 'assigned' }, options)
  const parentReply = `The specialist found evidence ${result.citationSources[0].marker}`
  expect(buildHubCitations(parentReply, recorded)[0]).toMatchObject({ title: 'Assigned plan', quote: 'Specialist evidence', documentVersionId: 'v1' })
})
