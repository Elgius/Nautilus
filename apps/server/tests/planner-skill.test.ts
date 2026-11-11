import { expect, test } from 'bun:test'
import type { Database } from '../src/db'
import type { AgentSkill } from '../src/agent_interface/skills'
import { createPlannerSkill } from '../src/planner/skill'
import type { AgentRunContext } from '../src/private-room-agents'
const taskId = 'c42bb233-85bc-49b4-9c94-e5af59bf06ca'
const profile = { id: 'moderator', name: 'Maya', role: 'Editor', rules: [] }
const specialist = { ...profile, id: 'specialist', name: 'Scout' }
const identity = { organizationId: 'org', roomId: 'room', userId: 'user', sessionId: 'session' }
async function execute(skill: AgentSkill, name: string, input: unknown) {
  const action = skill.tools[name]?.execute as unknown as (input: unknown, options: { toolCallId: string; messages: never[] }) => Promise<unknown>
  if (!action) throw new Error('Missing tool')
  return action(input, { toolCallId: crypto.randomUUID(), messages: [] })
}
function harness(reject = false, controller = new AbortController()) {
  let revision = 1, writes = 0
  const commits: unknown[] = [], reviews: unknown[] = [], checkpoints = new Map<string, unknown>()
  const db = {
    session: { findFirst: async () => ({}) }, roomMember: { findFirst: async () => ({}) }, roomAgent: { findFirst: async () => ({}) },
    room: { updateMany: async () => ({ count: 1 }) },
    plannerTask: { findFirst: async () => ({ id: taskId, revision, title: 'Report', changes: [] }),
      updateMany: async ({ where }: { where: { revision: number } }) => { if (where.revision !== revision) return { count: 0 }; writes++; revision++; return { count: 1 } },
      findUniqueOrThrow: async () => ({ id: taskId, revision }),
    }, plannerChange: { create: async () => ({}) },
    $transaction: async <T>(action: (tx: unknown) => Promise<T>) => action(db),
  }
  const run: AgentRunContext = { id: 'run', token: 'lease', activity: async () => {}, committed: async () => {}, taskCommitted: async (commit) => { commits.push(commit) }, checkpoint: async (id, value) => { checkpoints.set(id, structuredClone(value)) } }
  const skill = createPlannerSkill(identity, profile, run, async (action) => action(db as unknown as Database), controller.signal, {
    review: async (edit) => { reviews.push(edit); if (reject) throw new Error('Review rejected') }, profiles: async () => [profile, specialist],
    specialist: async (_agent, _instruction, _signal, skills) => {
      expect(skills[0].tools.updateTask).toBeUndefined()
      await expect(execute(skills[0], 'readTask', { taskId: 'out-of-scope' })).rejects.toThrow('outside')
      await execute(skills[0], 'readTask', { taskId })
      await execute(skills[0], 'proposeTaskUpdate', { taskId, expectedRevision: revision, status: 'In review' })
      return 'Proposed review'
    },
  })
  return { skill, commits, reviews, checkpoints, writes: () => writes, changeRevision: () => { revision++ } }
}
test('planner commits require a current read and independent approval', async () => {
  const h = harness(), input = { taskId, expectedRevision: 1, status: 'In progress' }
  await expect(execute(h.skill, 'updateTask', input)).rejects.toThrow('Read the current')
  expect(h.reviews).toHaveLength(0)
  await execute(h.skill, 'readTask', { taskId }); await execute(h.skill, 'updateTask', input)
  expect(h.reviews).toHaveLength(1); expect(h.commits).toEqual([{ taskId, revision: 2 }])
  await expect(execute(h.skill, 'updateTask', input)).rejects.toThrow('Read the current')
  expect(h.writes()).toBe(1)
})
test('rejected task review and cancellation never write', async () => {
  const rejected = harness(true)
  await execute(rejected.skill, 'readTask', { taskId })
  await expect(execute(rejected.skill, 'updateTask', { taskId, expectedRevision: 1, status: 'Done' })).rejects.toThrow('Review rejected')
  expect(rejected.writes()).toBe(0)
  const controller = new AbortController(), cancelled = harness(false, controller)
  await execute(cancelled.skill, 'readTask', { taskId }); controller.abort()
  await expect(execute(cancelled.skill, 'updateTask', { taskId, expectedRevision: 1, status: 'Done' })).rejects.toThrow()
  expect(cancelled.writes()).toBe(0)
})
test('specialist task proposals cannot write or escape scope and are accepted once', async () => {
  const h = harness()
  await execute(h.skill, 'delegateTaskWork', { agentId: 'specialist', taskIds: [taskId], instruction: 'Prepare review' })
  expect(h.writes()).toBe(0)
  const proposalId = [...h.checkpoints.keys()][0]
  await execute(h.skill, 'readTask', { taskId }); await execute(h.skill, 'acceptTaskProposal', { proposalId })
  await expect(execute(h.skill, 'acceptTaskProposal', { proposalId })).rejects.toThrow('unavailable')
  expect(h.writes()).toBe(1)
})
test('stale task proposals do not overwrite newer shared data', async () => {
  const h = harness()
  await execute(h.skill, 'delegateTaskWork', { agentId: 'specialist', taskIds: [taskId], instruction: 'Prepare review' })
  h.changeRevision(); await execute(h.skill, 'readTask', { taskId })
  await expect(execute(h.skill, 'acceptTaskProposal', { proposalId: [...h.checkpoints.keys()][0] })).rejects.toThrow('Read the current')
  expect(h.writes()).toBe(0)
})
