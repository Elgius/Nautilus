import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { createDatabase } from '../scripts/db'
import { agentChat } from '../src/agent-chat'
import { hubHistory } from '../src/hub-history'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'

// Explicit opt-in. Fixture identifiers are random and removed after verification.
test.skipIf(!process.env.TEST_HUB_HISTORY_DATABASE_URL)('hub turns survive reopening and stay scoped to a member and agent', async () => {
  const db = createDatabase(process.env.TEST_HUB_HISTORY_DATABASE_URL!)
  const users = [crypto.randomUUID(), crypto.randomUUID()]
  const orgs = [crypto.randomUUID(), crypto.randomUUID()]
  const agentId = crypto.randomUUID()
  function client(userId: string, organizationId: string) {
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('session', { user: { id: userId } } as AppEnv['Variables']['session'])
      c.set('organizationId', organizationId)
      c.set('db', db as unknown as Database)
      await next()
    })
    app.route('/agents', agentChat)
    app.route('/history', hubHistory)
    return app
  }
  try {
    await db.user.createMany({ data: users.map((id) => ({ id, name: 'Hub test', email: id + '@example.invalid' })) })
    await db.organization.createMany({ data: orgs.map((id) => ({ id, name: 'Hub test', slug: id })) })
    await db.member.createMany({ data: orgs.flatMap((organizationId) => users.map((userId) => ({ id: crypto.randomUUID(), organizationId, userId }))) })
    await db.agent.create({ data: { id: agentId, organizationId: orgs[0], name: 'Hub test', nameKey: 'hub test', role: 'Test' } })
    const turn = { id: crypto.randomUUID(), conversationId: crypto.randomUUID(), agentId, userId: users[0], createdAt: Date.now(), prompt: 'Question', reply: 'Answer' }
    const write = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(turn) }
    for (let i = 0; i < 2; i++) expect((await client(users[0], orgs[0]).request('/history', write)).status).toBe(200)
    const reopened = await client(users[0], orgs[0]).request('/history')
    expect(await reopened.json()).toMatchObject({ turns: [{ id: turn.id, prompt: turn.prompt, reply: turn.reply }], next: null })
    // Exercise the normal send path with a provider fixture and real database writes.
    const history = { id: crypto.randomUUID(), conversationId: turn.conversationId }
    const chat = { method: 'POST', headers: write.headers, body: JSON.stringify({
      history, messages: [{ role: 'user', content: 'Follow up' }],
    }) }
    const originalFetch = globalThis.fetch
    let generations = 0
    globalThis.fetch = Object.assign(async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]) !== 'https://api.openai.com/v1/responses') return originalFetch(...args)
      generations++
      return Response.json({
        id: 'resp_test', model: 'gpt-test', created_at: 1, status: 'completed',
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        output: [{ type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text: 'Saved answer', annotations: [] }] }],
      })
    }, { preconnect: originalFetch.preconnect })
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await client(users[0], orgs[0]).request(`/agents/${agentId}/chat`, chat, {
          OPENAI_API_KEY: 'test-key', LLM_MODEL: 'gpt-test',
        })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ turn: { ...history, prompt: 'Follow up', reply: 'Saved answer' } })
      }
      expect(generations).toBe(1)
    } finally { globalThis.fetch = originalFetch }
    const freshClient = await client(users[0], orgs[0]).request('/history')
    const saved = await freshClient.json() as { turns: { id: string }[] }
    expect(saved.turns).toHaveLength(2)
    expect(saved.turns.find((entry) => entry.id === history.id)).toMatchObject({ conversationId: turn.conversationId, reply: 'Saved answer' })
    for (const [user, org] of [[users[1], orgs[0]], [users[0], orgs[1]]]) {
      expect(await (await client(user, org).request('/history')).json()).toEqual({ turns: [], next: null })
    }
    expect((await client(users[1], orgs[0]).request('/history', write)).status).toBe(403)
  } finally {
    try {
      await db.organization.deleteMany({ where: { id: { in: orgs } } })
      await db.user.deleteMany({ where: { id: { in: users } } })
    } finally { await db.$disconnect() }
  }
}, 45_000)
