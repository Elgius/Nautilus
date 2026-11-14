import { expect, test } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import { createAgentInterface } from '../src/agent_interface'
import { createPlannerReadSkill } from '../src/agent_interface/planner-read-skill'
import type { Database } from '../src/db'
import type { AgentRunContext } from '../src/private-room-agents'

const identity = { organizationId: 'org', roomId: 'room', userId: 'user', sessionId: 'session' }
const profile = { id: 'agent', name: 'Scout', role: 'Planner', rules: [] }
const taskId = 'c42bb233-85bc-49b4-9c94-e5af59bf06ca'
const task = { id: taskId, title: 'Report', description: 'Prepare report', status: 'To do', date: '2026-11-20', agentIds: ['agent'], revision: 2, changes: [] }
function harness() {
  let session = true, member = true, assigned = true, failure = false
  const queries: { kind: string; query: unknown }[] = []
  const record = (kind: string, query: unknown) => { queries.push({ kind, query }); if (failure) throw new Error('postgres://SECRET/internal') }
  const db = {
    session: { findFirst: async () => session ? {} : null },
    roomMember: { findFirst: async () => member ? {} : null },
    roomAgent: { findFirst: async () => assigned ? {} : null },
    plannerTask: {
      findMany: async (query: unknown) => { record('tasks', query); return Array.from({ length: 101 }, (_, i) => ({ ...task, id: `task-${i}` })) },
      findFirst: async (query: unknown) => { record('task', query); return task },
    },
    schedulerSchedule: { findMany: async (query: unknown) => { record('schedules', query); return Array.from({ length: 51 }, (_, i) => ({ id: `schedule-${i}`, event: { title: 'Review', taskId }, deliveries: [] })) } },
  } as unknown as Database
  const controller = new AbortController()
  const run: AgentRunContext = { id: 'run', token: '', mode: 'read', activity: async () => {}, committed: async () => {}, checkpoint: async () => {} }
  const skill = createPlannerReadSkill(identity, profile, run, async (action) => action(db), controller.signal)
  const execute = (name: string, input: unknown = {}, abortSignal?: AbortSignal) => {
    const action = skill.tools[name].execute as unknown as (input: unknown, options: { toolCallId: string; messages: never[]; abortSignal?: AbortSignal }) => Promise<unknown>
    return action(input, { toolCallId: 'call', messages: [], abortSignal })
  }
  return { skill, execute, queries, controller, revokeSession: () => { session = false }, revokeMember: () => { member = false }, revokeAssignment: () => { assigned = false }, fail: () => { failure = true } }
}

test('Ask planner exposes only three callable read tools and preserves pagination and calendar fields', async () => {
  const h = harness()
  expect(Object.keys(h.skill.tools).toSorted()).toEqual(['listScheduledEvents', 'listTasks', 'readTask'])
  const tasks = await h.execute('listTasks', { after: 'previous-task' }) as { tasks: unknown[]; nextCursor: string }
  expect(tasks.tasks).toHaveLength(100)
  expect(tasks.tasks[0]).toMatchObject({ date: task.date, status: task.status, agentIds: task.agentIds, revision: 2 })
  expect(tasks.nextCursor).toBe('task-99')
  expect(await h.execute('readTask', { taskId })).toEqual(task)
  const schedules = await h.execute('listScheduledEvents', { after: 'previous-event' }) as { schedules: unknown[]; nextCursor: string }
  expect(schedules.schedules).toHaveLength(50)
  expect(schedules.nextCursor).toBe('schedule-49')
  expect(h.queries[0].query).toMatchObject({ where: { organizationId: 'org', roomId: 'room', deletedAt: null, id: { gt: 'previous-task' } } })
  expect(h.queries[1].query).toMatchObject({ where: { organizationId: 'org', roomId: 'room', id: taskId, deletedAt: null } })
  expect(h.queries[2].query).toMatchObject({ where: { event: { organizationId: 'org', roomId: 'room', ownerUserId: 'user' }, id: { gt: 'previous-event' } } })
})

test('Ask planner rechecks session, membership, assignment and cancellation for each read', async () => {
  for (const tool of ['listTasks', 'readTask', 'listScheduledEvents']) {
    for (const revoke of ['revokeSession', 'revokeMember', 'revokeAssignment'] as const) {
      const h = harness()
      await h.execute(tool, { taskId })
      h.queries.length = 0
      h[revoke]()
      await expect(h.execute(tool, { taskId })).rejects.toThrow('expired')
      expect(h.queries).toEqual([])
    }
    for (const scope of ['run', 'tool']) {
      const h = harness(), controller = scope === 'run' ? h.controller : new AbortController()
      controller.abort()
      await expect(h.execute(tool, { taskId }, controller.signal)).rejects.toThrow()
      expect(h.queries).toEqual([])
    }
  }
})

test('Ask planner redacts internal database errors', async () => {
  const h = harness()
  h.fail()
  await expect(h.execute('listTasks')).rejects.toThrow('The planner could not complete this read.')
})

test('AI SDK can call all Ask planner reads and rejects injected identity and write tools', async () => {
  const h = harness()
  const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 2, text: 2, reasoning: undefined } }
  const finish = { usage, warnings: [], finishReason: { unified: 'tool-calls' as const, raw: undefined } }
  const call = (toolName: string, input: unknown) => ({ ...finish, content: [{ type: 'tool-call' as const, toolName, toolCallId: crypto.randomUUID(), input: JSON.stringify(input) }] })
  const model = new MockLanguageModelV4({ doGenerate: [
    call('listTasks', {}), call('readTask', { taskId }), call('listScheduledEvents', {}),
    call('listTasks', { roomId: 'other-room' }), call('readTask', { taskId, organizationId: 'other-org' }),
    call('listScheduledEvents', { ownerUserId: 'other-user' }), call('updateTask', { taskId, status: 'Done' }),
    { ...finish, finishReason: { unified: 'stop' as const, raw: undefined }, content: [{ type: 'text' as const, text: 'Read the planner.' }] },
  ] })
  await createAgentInterface(profile, model, [h.skill], { toolCallConcurrency: 3 }).generate({ prompt: 'Read my room board and calendar.' })
  expect(h.queries.map(({ kind }) => kind)).toEqual(['tasks', 'task', 'schedules'])
  expect(JSON.stringify(model.doGenerateCalls[3].prompt)).toContain('Prepare report')
  expect(model.doGenerateCalls[0].tools?.map((tool) => tool.name).toSorted()).toEqual(['listScheduledEvents', 'listTasks', 'readTask'])
})
