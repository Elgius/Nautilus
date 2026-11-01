import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { MockLanguageModelV4 } from 'ai/test'
import { createRoomAgentChat } from '../src/room-agent-chat'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'

function harness(options: { assigned?: boolean; target?: boolean; fail?: boolean } = {}) {
  const writes: unknown[] = [], lookups: unknown[] = []
  const profile = { id: 'agent-1', name: 'Scout', role: 'Research', rules: ['Cite sources.'] }
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    if (options.fail) throw new Error('Private provider details')
    return { content: [{ type: 'text' as const, text: 'Here is my research.' }],
      finishReason: { unified: 'stop' as const, raw: undefined }, warnings: [],
      usage: { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 2, text: 2, reasoning: undefined } } }
  } })
  const db = {
    roomAgent: { findFirst: async (query: unknown) => { lookups.push(query); return options.assigned === false ? null : { agent: profile } } },
    roomMessage: {
      findFirst: async (query: unknown) => { lookups.push(query); return options.target === false ? null : { id: 'msg-1', createdAt: new Date(0) } },
      findMany: async (query: unknown) => { lookups.push(query); return [
        { text: 'Research oceans', authorAgentId: null, authorUser: { name: 'Alex' }, authorAgent: null },
        { text: 'What topic?', authorAgentId: 'agent-1', authorUser: null, authorAgent: { name: 'Scout' } },
      ] },
      create: async (query: unknown) => { writes.push(query); return { id: 'reply-1', text: 'Here is my research.' } },
    },
    room: { update: async () => ({}) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  }
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('organizationId', 'org-1'); c.set('db', db as unknown as Database)
    c.set('session', { user: { id: 'user-1' } } as AppEnv['Variables']['session'])
    await next()
  })
  app.route('/', createRoomAgentChat(() => model))
  app.onError((error, c) => c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500))
  const request = (body: unknown = { agentId: 'agent-1' }) => app.request('/room-1/messages/msg-1/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return { request, writes, lookups, model }
}

test('room reply uses saved profile and history, and persists the agent author', async () => {
  const { request, writes, lookups, model } = harness()
  expect((await request()).status).toBe(201)
  expect(lookups[0]).toMatchObject({ where: { organizationId: 'org-1', roomId: 'room-1', agentId: 'agent-1' } })
  expect(lookups[1]).toMatchObject({ where: { authorUserId: 'user-1', roomId: 'room-1', organizationId: 'org-1' } })
  expect(model.doGenerateCalls[0].prompt[0].content).toContain('Rule: Cite sources.')
  expect(model.doGenerateCalls[0].prompt.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Alex: Research oceans' }] })
  expect(writes[0]).toMatchObject({ data: { organizationId: 'org-1', roomId: 'room-1', authorAgentId: 'agent-1', text: 'Here is my research.' } })
})

test('room reply rejects missing assignments and messages before generating', async () => {
  for (const options of [{ assigned: false }, { target: false }]) {
    const { request, model, writes } = harness(options)
    expect((await request()).status).toBe(404)
    expect(model.doGenerateCalls).toHaveLength(0); expect(writes).toHaveLength(0)
  }
  expect((await harness().request({})).status).toBe(400)
})

test('provider failure exposes no provider details and creates no reply', async () => {
  const { request, writes } = harness({ fail: true })
  const response = await request()
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('Private provider details')
  expect(writes).toHaveLength(0)
})
