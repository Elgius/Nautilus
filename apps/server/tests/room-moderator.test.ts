import { expect, test } from 'bun:test'
import { createModeratorSkills, type Proposal } from '../src/room-moderator'
import type { AgentRunContext, PrivateAgentProfile } from '../src/private-room-agents'
import type { AgentSkill } from '../src/agent_interface'
import type { SkillBackend } from '../src/agent_interface/skills'
import type { DocumentCreation } from '../src/documents/creation'
import { HTTPException } from 'hono/http-exception'
import type { CreationReview, EditReview } from '../src/edit-review'

const moderator = { id: 'moderator', name: 'Maya', role: 'Editor', rules: [] }
const specialist = { id: 'specialist', name: 'Scout', role: 'Analyst', rules: [] }
const other = { ...specialist, id: 'other', name: 'Other' }
const edit = { documentId: 'doc', expectedVersionId: 'v1', changeSummary: 'Update greeting', edits: [
  { type: 'replaceText', start: 0, end: 5, expectedText: 'Hello', text: 'World' },
] }
async function execute(skills: AgentSkill[], name: string, input: unknown) {
  const definition = skills.flatMap((skill) => Object.entries(skill.tools)).find(([key]) => key === name)?.[1]
  if (!definition?.execute) throw new Error(`Missing tool ${name}`)
  const run = definition.execute as unknown as (input: unknown, options: { toolCallId: string; messages: never[] }) => Promise<unknown>
  return run(input, { toolCallId: crypto.randomUUID(), messages: [] })
}
function harness(prepare?: (agent: PrivateAgentProfile, skills: AgentSkill[]) => Promise<string>, review: (edit: EditReview) => Promise<void> = async () => {}, signal: AbortSignal = new AbortController().signal, read?: SkillBackend['read'], creationReview: (creation: CreationReview) => Promise<void> = async () => {}, findCreation?: SkillBackend['findCreation']) {
  const writes: unknown[] = [], commits: unknown[] = [], checkpoints = new Map<string, Proposal>()
  let version = 'v1'
  const source: SkillBackend = {
    findCreation,
    authorize: async () => {}, list: async () => [],
    read: read ?? (async () => ({ currentVersionId: version, kind: 'DOCUMENT', result: { text: 'Hello' } })),
    create: async (input) => { writes.push(input); return { documentId: 'created', versionId: 'first', versionNumber: 1, requestId: input.requestId, saved: true, replayed: false } },
    edit: async (...args) => {
      if (args[1] !== version) throw new HTTPException(409, { message: 'A newer document version exists.' })
      writes.push(args)
      const versionNumber = writes.length + 1
      version = `v${versionNumber}`
      return { versionId: version, versionNumber }
    },
  }
  const run: AgentRunContext = { id: 'run', token: 'lease', activity: async () => {},
    committed: async (commit) => { commits.push(commit) }, checkpoint: async (id, value) => { checkpoints.set(id, structuredClone(value) as Proposal) } }
  const { skills, hasPendingArtifactReviews } = createModeratorSkills(moderator, run, signal, {
    review, reviewCreation: creationReview, backend: () => source, profiles: async () => [moderator, specialist, other],
    specialist: async (agent, _instruction, _signal, tools) => {
      if (prepare) return prepare(agent, tools)
      await execute(tools, 'readDocument', { documentId: 'doc' })
      expect(tools.some((skill) => 'applyDocumentEdits' in skill.tools)).toBe(false)
      const result = await execute(tools, 'proposeDocumentEdits', edit)
      expect(result).toMatchObject({ saved: false, status: 'proposed' })
      return 'Prepared a proposal.'
    },
  })
  return { skills, hasPendingArtifactReviews, writes, commits, checkpoints, changeVersion: () => { version = 'v-other' } }
}
const assignment = { assignments: [{ agentId: specialist.id, documentIds: ['doc'], instruction: 'Improve the greeting' }] }

test('completion requires a read and final review of the latest saved version', async () => {
  const h = harness()
  expect(h.hasPendingArtifactReviews()).toBe(false)
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await execute(h.skills, 'applyDocumentEdits', edit)
  expect(h.hasPendingArtifactReviews()).toBe(true)
  const review = { documentId: 'doc', versionId: 'v2', checks: ['Checked the revised greeting and its formatting.'], limitations: ['No rendered page available.'] }
  await expect(execute(h.skills, 'recordArtifactReview', review)).rejects.toMatchObject({ code: 'ARTIFACT_REVIEW_REQUIRED' })
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await execute(h.skills, 'recordArtifactReview', review)
  expect(h.hasPendingArtifactReviews()).toBe(false)

  await execute(h.skills, 'applyDocumentEdits', { ...edit, expectedVersionId: 'v2' })
  expect(h.hasPendingArtifactReviews()).toBe(true)
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await expect(execute(h.skills, 'recordArtifactReview', review)).rejects.toMatchObject({ code: 'ARTIFACT_REVIEW_REQUIRED' })
  await execute(h.skills, 'recordArtifactReview', { ...review, versionId: 'v3' })
  expect(h.hasPendingArtifactReviews()).toBe(false)
})

test('specialists prepare proposals without writes; moderator acceptance saves once with attribution', async () => {
  const h = harness()
  await execute(h.skills, 'delegateWork', assignment)
  expect(h.writes).toHaveLength(0)
  const proposalId = [...h.checkpoints.keys()][0]
  await execute(h.skills, 'acceptProposal', { proposalId })
  expect(h.writes).toHaveLength(1)
  expect(h.commits).toEqual([{ documentId: 'doc', versionId: 'v2', versionNumber: 2 }])
  expect(h.hasPendingArtifactReviews()).toBe(true)
  expect(h.checkpoints.get(proposalId)?.status).toBe('applied')
  await expect(execute(h.skills, 'acceptProposal', { proposalId })).rejects.toThrow('applied')
  expect(h.writes).toHaveLength(1)
})

test('stale proposals fail without overwriting newer versions', async () => {
  const h = harness()
  await execute(h.skills, 'delegateWork', assignment)
  h.changeVersion()
  const proposalId = [...h.checkpoints.keys()][0]
  await expect(execute(h.skills, 'acceptProposal', { proposalId })).rejects.toThrow('newer')
  expect(h.writes).toHaveLength(0)
  expect(h.checkpoints.get(proposalId)?.status).toBe('rejected')
})

test('specialist reads and proposals cannot escape assigned documents', async () => {
  let blocked = 0
  const h = harness(async (_agent, tools) => {
    for (const [name, input] of [['readDocument', { documentId: 'private-doc' }], ['proposeDocumentEdits', { ...edit, documentId: 'private-doc' }]] as const) {
      await expect(execute(tools, name, input)).rejects.toThrow(); blocked++
    }
    return 'No out-of-scope access'
  })
  await execute(h.skills, 'delegateWork', assignment)
  expect(blocked).toBe(2); expect(h.writes).toHaveLength(0)
  expect(h.checkpoints.size).toBe(0)
})

test('independent specialist assignments actually run in parallel', async () => {
  let entered = 0, release!: () => void, both!: () => void
  const ready = new Promise<void>((resolve) => { both = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const h = harness(async () => { if (++entered === 2) both(); await gate; return 'Ready' })
  const running = execute(h.skills, 'delegateWork', { assignments: [...assignment.assignments, { ...assignment.assignments[0], agentId: other.id }] })
  await ready; expect(entered).toBe(2); release(); await running
  expect(h.writes).toHaveLength(0)
})

test('unassigned agents and moderator self-delegation never execute', async () => {
  const h = harness()
  for (const agentId of ['outsider', moderator.id]) await expect(execute(h.skills, 'delegateWork', {
    assignments: [{ ...assignment.assignments[0], agentId }],
  })).rejects.toThrow()
  expect(h.writes).toHaveLength(0)
})


test('rejected independent review blocks both direct and proposed commits', async () => {
  const h = harness(undefined, async () => { throw new HTTPException(422, { message: 'Review rejected' }) })
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await expect(execute(h.skills, 'applyDocumentEdits', edit)).rejects.toThrow('Review rejected')
  await execute(h.skills, 'delegateWork', assignment)
  const proposalId = [...h.checkpoints.keys()][0]
  await expect(execute(h.skills, 'acceptProposal', { proposalId })).rejects.toThrow('Review rejected')
  expect(h.writes).toHaveLength(0)
  expect(h.commits).toHaveLength(0)
})


test('direct commits require independent review before writing', async () => {
  let reviews = 0
  const h = harness(undefined, async () => { expect(h.writes).toHaveLength(0); reviews++ })
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await execute(h.skills, 'applyDocumentEdits', edit)
  expect(reviews).toBe(1)
  expect(h.writes).toHaveLength(1)
})


test('cancellation during review blocks committing an approved edit', async () => {
  const controller = new AbortController()
  const h = harness(undefined, async () => { controller.abort() }, controller.signal)
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await expect(execute(h.skills, 'applyDocumentEdits', edit)).rejects.toThrow()
  expect(h.writes).toHaveLength(0)
  expect(h.commits).toHaveLength(0)
})

for (const delegated of [false, true]) test(`cross-document ${delegated ? 'proposals' : 'direct edits'} include versioned source evidence`, async () => {
  const reviews: EditReview[] = []
  const read: SkillBackend['read'] = async (id) => id === 'workbook'
    ? { currentVersionId: 'workbook-v3', kind: 'SPREADSHEET', result: { value: 42 } }
    : { currentVersionId: 'v1', kind: 'DOCUMENT', result: { text: 'Hello' } }
  const h = harness(async (_agent, tools) => {
    await execute(tools, 'readWorkbook', { documentId: 'workbook' })
    await execute(tools, 'readDocument', { documentId: 'doc' })
    await execute(tools, 'proposeDocumentEdits', edit)
    return 'Prepared a cross-document edit.'
  }, async (candidate) => { reviews.push(candidate) }, undefined, read)
  if (delegated) {
    await execute(h.skills, 'delegateWork', { assignments: [{ ...assignment.assignments[0], documentIds: ['workbook', 'doc'] }] })
    await execute(h.skills, 'acceptProposal', { proposalId: [...h.checkpoints.keys()][0] })
  } else {
    await execute(h.skills, 'readWorkbook', { documentId: 'workbook' })
    await execute(h.skills, 'readDocument', { documentId: 'doc' })
    await execute(h.skills, 'applyDocumentEdits', edit)
  }
  expect(reviews).toHaveLength(1)
  expect(reviews[0].reads).toEqual([
    { documentId: 'workbook', currentVersionId: 'workbook-v3', kind: 'SPREADSHEET',
      reads: [{ operation: 'readWorkbook', args: {}, result: { value: 42 } }] },
    { documentId: 'doc', currentVersionId: 'v1', kind: 'DOCUMENT',
      reads: [{ operation: 'readDocument', args: {}, result: { text: 'Hello' } }] },
  ])
  expect(h.writes).toHaveLength(1)
})

test('oversized failed reads do not retain evidence or prevent narrower reads and edits', async () => {
  let calls = 0
  const reviews: EditReview[] = []
  const narrow = { text: 'Hello' + 'x'.repeat(20_000) }
  const h = harness(undefined, async (candidate) => { reviews.push(candidate) }, undefined, async () => ({
    currentVersionId: 'v1', kind: 'DOCUMENT', result: ++calls === 2 ? { text: 'x'.repeat(70_000) } : narrow,
  }))
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await expect(execute(h.skills, 'readDocument', { documentId: 'doc' })).rejects.toThrow('Read result too large')
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await execute(h.skills, 'applyDocumentEdits', edit)
  expect(reviews[0].reads).toEqual([{ documentId: 'doc', currentVersionId: 'v1', kind: 'DOCUMENT', reads: [
    { operation: 'readDocument', args: {}, result: narrow },
    { operation: 'readDocument', args: {}, result: narrow },
  ] }])
  expect(h.writes).toHaveLength(1)
})

const creation: DocumentCreation = { kind: 'DOCUMENT', requestId: '00000000-0000-4000-8000-000000000002', title: 'Brief', category: 'Notes', changeSummary: 'Create brief', paragraphs: [{ text: 'Requested content' }] }
const { kind: _creationKind, ...creationInput } = creation

test('direct creation is independently reviewed with exact content and listing before a recorded commit', async () => {
  const candidates: CreationReview[] = []
  const h = harness(undefined, undefined, undefined, undefined, async (candidate) => {
    expect(h.writes).toHaveLength(0); candidates.push(candidate)
  })
  expect(await execute(h.skills, 'createDocument', creationInput)).toMatchObject({ saved: true, versionNumber: 1 })
  expect(candidates[0]).toMatchObject({ operation: 'create', input: creation, reads: [{ operation: 'listDocuments' }] })
  expect(h.writes).toEqual([creation])
  expect(h.commits).toEqual([{ documentId: 'created', versionId: 'first', versionNumber: 1 }])
})

test('rejected or cancelled creation review never reaches the writer', async () => {
  const denied = harness(undefined, undefined, undefined, undefined, async () => { throw new HTTPException(422, { message: 'Creation rejected' }) })
  await expect(execute(denied.skills, 'createDocument', creationInput)).rejects.toThrow('Creation rejected')
  expect(denied.writes).toHaveLength(0)
  const controller = new AbortController()
  const cancelled = harness(undefined, undefined, controller.signal, undefined, async () => { controller.abort() })
  await expect(execute(cancelled.skills, 'createDocument', creationInput)).rejects.toThrow()
  expect(cancelled.writes).toHaveLength(0)
})

test('specialists cannot create unless assigned; authorized creations remain proposals until reviewed acceptance', async () => {
  const noCreation = harness(async (_agent, skills) => {
    expect(skills.some((skill) => 'createDocument' in skill.tools || 'proposeCreateDocument' in skill.tools)).toBe(false)
    return 'No creation allowed'
  })
  await execute(noCreation.skills, 'delegateWork', assignment)
  expect(noCreation.writes).toHaveLength(0)
  const h = harness(async (_agent, skills) => {
    expect(skills.some((skill) => 'createDocument' in skill.tools)).toBe(false)
    expect(await execute(skills, 'proposeCreateDocument', creationInput)).toMatchObject({ saved: false, status: 'proposed' })
    return 'Creation proposed'
  })
  await execute(h.skills, 'delegateWork', { assignments: [{ agentId: specialist.id, documentIds: [], allowCreation: true, instruction: 'Create a brief' }] })
  expect(h.writes).toHaveLength(0)
  const proposalId = [...h.checkpoints.keys()][0]
  await execute(h.skills, 'acceptProposal', { proposalId })
  expect(h.writes).toEqual([creation])
  await expect(execute(h.skills, 'acceptProposal', { proposalId })).rejects.toThrow('applied')
  expect(h.writes).toHaveLength(1)
})

test('spreadsheet tool submits structured formulas and values through creation review', async () => {
  const h = harness(undefined, undefined, undefined, async () => ({
    currentVersionId: 'first', kind: 'SPREADSHEET', result: { cells: [[{ v: 5 }, { f: '=A1*2' }]] },
  }))
  const input = { requestId: creation.requestId, title: 'Budget', category: 'Notes', changeSummary: 'Create budget', sheets: [{ name: 'Budget', cells: [{ row: 0, column: 0, value: 5 }, { row: 0, column: 1, formula: '=A1*2' }] }] }
  await execute(h.skills, 'createSpreadsheet', input)
  expect(h.writes).toEqual([{ kind: 'SPREADSHEET', ...input }])
  expect(h.hasPendingArtifactReviews()).toBe(true)
  await execute(h.skills, 'readRange', { documentId: 'created', sheetId: 'sheet-1', row: 0, column: 0, rows: 1, columns: 2 })
  await execute(h.skills, 'recordArtifactReview', {
    documentId: 'created', versionId: 'first',
    checks: ['Checked the saved budget value and the formula reference.'], limitations: ['Recalculation unavailable.'],
  })
  expect(h.hasPendingArtifactReviews()).toBe(false)
})


test('durable replay returns the original commit without a second mutation or duplicate-creation review', async () => {
  const saved = { documentId: 'existing', versionId: 'first', versionNumber: 1, requestId: creation.requestId, saved: true as const, replayed: true }
  const h = harness(undefined, undefined, undefined, undefined, async () => { throw new Error('A receipt must not require another review') }, async () => saved)
  expect(await execute(h.skills, 'createDocument', creationInput)).toEqual(saved)
  expect(h.writes).toHaveLength(0)
  expect(h.commits).toEqual([{ documentId: 'existing', versionId: 'first', versionNumber: 1 }])
  expect(h.hasPendingArtifactReviews()).toBe(false)
})

test('a coherent multi-operation batch receives one review and creates one committed version', async () => {
  let reviews = 0
  const h = harness(undefined, async (candidate) => { reviews++; expect(candidate.edits).toHaveLength(3) })
  await execute(h.skills, 'readDocument', { documentId: 'doc' })
  await execute(h.skills, 'applyDocumentEdits', { ...edit, edits: [
    { type: 'insertText', index: 0, text: 'Checkpoint Tutorial\r\n' },
    { type: 'insertText', index: 21, text: 'Section 1\r\n' },
    { type: 'insertText', index: 32, text: 'Question 1\r\nQuestion 2\r\nQuestion 3\r\n' },
  ] })
  expect(reviews).toBe(1)
  expect(h.writes).toHaveLength(1)
  expect(h.commits).toHaveLength(1)
})

test('specialist listing excludes the moderator itself', async () => {
  const h = harness()
  const choices = await execute(h.skills, 'listSpecialists', {}) as { id: string }[]
  expect(choices.some(({ id }) => id === moderator.id)).toBe(false)
})
