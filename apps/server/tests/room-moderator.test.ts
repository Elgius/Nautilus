import { expect, test } from 'bun:test'
import { createModeratorSkills, type Proposal } from '../src/room-moderator'
import type { AgentRunContext, PrivateAgentProfile } from '../src/private-room-agents'
import type { AgentSkill } from '../src/agent_interface'
import type { SkillBackend } from '../src/agent_interface/skills'
import { HTTPException } from 'hono/http-exception'
import type { EditReview } from '../src/edit-review'

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
function harness(prepare?: (agent: PrivateAgentProfile, skills: AgentSkill[]) => Promise<string>, review: (edit: EditReview) => Promise<void> = async () => {}, signal: AbortSignal = new AbortController().signal, read?: SkillBackend['read']) {
  const writes: unknown[] = [], commits: unknown[] = [], checkpoints = new Map<string, Proposal>()
  let version = 'v1'
  const source: SkillBackend = {
    authorize: async () => {}, list: async () => [],
    read: read ?? (async () => ({ currentVersionId: version, kind: 'DOCUMENT', result: { text: 'Hello' } })),
    edit: async (...args) => {
      if (args[1] !== version) throw new HTTPException(409, { message: 'A newer document version exists.' })
      writes.push(args); version = 'v2'; return { versionId: 'v2', versionNumber: 2 }
    },
  }
  const run: AgentRunContext = { id: 'run', token: 'lease', activity: async () => {},
    committed: async (commit) => { commits.push(commit) }, checkpoint: async (id, value) => { checkpoints.set(id, structuredClone(value) as Proposal) } }
  const skills = createModeratorSkills(moderator, run, signal, {
    review, backend: () => source, profiles: async () => [moderator, specialist, other],
    specialist: async (agent, _instruction, _signal, tools) => {
      if (prepare) return prepare(agent, tools)
      await execute(tools, 'readDocument', { documentId: 'doc' })
      expect(tools.some((skill) => 'applyDocumentEdits' in skill.tools)).toBe(false)
      const result = await execute(tools, 'proposeDocumentEdits', edit)
      expect(result).toMatchObject({ saved: false, status: 'proposed' })
      return 'Prepared a proposal.'
    },
  })
  return { skills, writes, commits, checkpoints, changeVersion: () => { version = 'v-other' } }
}
const assignment = { assignments: [{ agentId: specialist.id, documentIds: ['doc'], instruction: 'Improve the greeting' }] }

test('specialists prepare proposals without writes; moderator acceptance saves once with attribution', async () => {
  const h = harness()
  await execute(h.skills, 'delegateWork', assignment)
  expect(h.writes).toHaveLength(0)
  const proposalId = [...h.checkpoints.keys()][0]
  await execute(h.skills, 'acceptProposal', { proposalId })
  expect(h.writes).toHaveLength(1)
  expect(h.commits).toEqual([{ documentId: 'doc', versionId: 'v2', versionNumber: 2 }])
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
