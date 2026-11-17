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
    await db.agent.create({ data: { id: agentId, organizationId: orgs[0], createdByUserId: users[0], name: 'Hub test', nameKey: 'hub test', role: 'Test' } })
    const turn = { id: crypto.randomUUID(), conversationId: crypto.randomUUID(), agentId, userId: users[0], createdAt: Date.now(), prompt: 'Question', reply: 'Answer' }
    const write = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-User': users[0] }, body: JSON.stringify(turn) }
    for (let i = 0; i < 2; i++) expect((await client(users[0], orgs[0]).request('/history', write)).status).toBe(200)
    const read = { headers: { 'X-Hub-User': users[0] } }
    const transcriptPath = '/history/' + turn.conversationId
    const reopened = await client(users[0], orgs[0]).request(transcriptPath, read)
    expect(await reopened.json()).toMatchObject({ turns: [{ id: turn.id, prompt: turn.prompt, reply: turn.reply }] })
    // Exercise the normal send path with a provider fixture and real database writes.
    const history = { id: crypto.randomUUID(), conversationId: turn.conversationId }
    const chat = { method: 'POST', headers: write.headers, body: JSON.stringify({
      history, messages: [{ role: 'user', content: 'Follow up' }],
    }) }
    const originalFetch = globalThis.fetch
    let generations = 0
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    globalThis.fetch = Object.assign(async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]) !== 'https://api.openai.com/v1/responses') return originalFetch(...args)
      generations++
      started.resolve()
      await release.promise
      return Response.json({
        id: 'resp_test', model: 'gpt-test', created_at: 1, status: 'completed',
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        output: [{ type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text: 'Saved answer', annotations: [] }] }],
      })
    }, { preconnect: originalFetch.preconnect })
    try {
      const send = () => client(users[0], orgs[0]).request(`/agents/${agentId}/chat`, chat, {
        OPENAI_API_KEY: 'test-key', LLM_MODEL: 'gpt-test',
      })
      const first = Promise.resolve(send())
      await Promise.race([started.promise, first.then(() => { throw new Error('Provider did not start') })])
      try {
        expect((await send()).status).toBe(409)
        const pending = await client(users[0], orgs[0]).request(transcriptPath, read)
        expect((await pending.json() as { turns: unknown[] }).turns).toHaveLength(1)
      } finally { release.resolve() }
      for (const response of [await first, await send()]) {
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ turn: { ...history, prompt: 'Follow up', reply: 'Saved answer' } })
      }
      expect(generations).toBe(1)
    } finally { release.resolve(); globalThis.fetch = originalFetch }
    const freshClient = await client(users[0], orgs[0]).request(transcriptPath, read)
    const saved = await freshClient.json() as { turns: { id: string }[] }
    expect(saved.turns).toHaveLength(2)
    expect(saved.turns.find((entry) => entry.id === history.id)).toMatchObject({ conversationId: turn.conversationId, reply: 'Saved answer' })
    for (const [user, org] of [[users[1], orgs[0]], [users[0], orgs[1]]]) {
      const result = await client(user, org).request(transcriptPath, { headers: { 'X-Hub-User': user } })
      expect(await result.json()).toEqual({ turns: [] })
    }
    const staleTab = client(users[1], orgs[0])
    for (const path of ['/history', transcriptPath]) expect((await staleTab.request(path, read)).status).toBe(403)
    expect((await staleTab.request('/history', write)).status).toBe(403)
    expect((await staleTab.request(`/agents/${agentId}/chat`, chat)).status).toBe(403)

    const extra = Array.from({ length: 50 }, () => ({ organizationId: orgs[0], userId: users[0], id: crypto.randomUUID(), agentId }))
    await db.hubConversation.createMany({ data: extra })
    await db.hubTurn.createMany({ data: extra.map(({ organizationId, userId, id }) => ({ organizationId, userId, conversationId: id,
      id: crypto.randomUUID(), prompt: 'a'.repeat(250), reply: 'b'.repeat(250) })) })
    const one = await client(users[0], orgs[0]).request('/history', read)
    const page = await one.json() as { summaries: { id: string; title: string; preview: string }[]; next: string }
    expect(page.summaries).toHaveLength(50)
    expect(page.summaries.every((item) => item.title.length <= 160 && item.preview.length <= 160 && !('turns' in item))).toBe(true)
    const two = await client(users[0], orgs[0]).request('/history?after=' + encodeURIComponent(page.next), read)
    const end = await two.json() as typeof page
    expect(end.next).toBeNull()
    expect(new Set([...page.summaries, ...end.summaries].map((item) => item.id)).size).toBe(51)
  } finally {
    try {
      await db.organization.deleteMany({ where: { id: { in: orgs } } })
      await db.user.deleteMany({ where: { id: { in: users } } })
    } finally { await db.$disconnect() }
  }
}, 45_000)
