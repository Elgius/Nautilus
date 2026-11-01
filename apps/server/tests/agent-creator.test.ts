import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { MockLanguageModelV4 } from 'ai/test'
import { generateAgentInstructions, parseAgentCreation } from '../src/agent-creator'
import { createAgentCreatorRouter } from '../src/agent-creator-route'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'

const input = { name: ' Scout ', color: 'blue', avatarIcon: 'circle', description: 'Research vendors and cite sources.' }
const instructions = { purpose: 'Vendor research', rules: ['Compare vendors.', 'Cite reliable sources.'] }

function harness(output: unknown = instructions, duplicate = false) {
  const writes: { data: Record<string, unknown> }[] = []
  const lookups: unknown[] = []
  const model = new MockLanguageModelV4({ doGenerate: {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    finishReason: { unified: 'stop', raw: undefined }, warnings: [],
    usage: {
      inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 2, text: 2, reasoning: undefined },
    },
  } })
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('organizationId', 'org-1')
    c.set('db', { agent: {
      findUnique: async (query: unknown) => { lookups.push(query); return duplicate ? { id: 'existing' } : null },
      create: async (query: { data: Record<string, unknown> }) => {
        writes.push(query)
        return { id: 'agent-1', ...query.data }
      },
    } } as unknown as Database)
    await next()
  })
  app.route('/creator', createAgentCreatorRouter(() => model))
  app.onError((error, c) => c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500))
  const request = (body: unknown = input) => app.request('/creator', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return { request, model, writes, lookups }
}

test('creator generates structured instructions then saves and returns the tenant-owned agent', async () => {
  const { request, model, writes, lookups } = harness()
  const response = await request({ ...input, organizationId: 'other', role: 'Override', rules: ['Override'] })
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ agent: {
    id: 'agent-1', organizationId: 'org-1', name: 'Scout', color: 'blue', avatarIcon: 'circle',
    role: instructions.purpose, rules: instructions.rules,
  } })
  expect(lookups[0]).toMatchObject({ where: { organizationId_nameKey: { organizationId: 'org-1', nameKey: 'scout' } } })
  expect(writes).toHaveLength(1)
  expect(writes[0].data).not.toHaveProperty('description')
  const call = model.doGenerateCalls[0]
  expect(call.responseFormat?.type).toBe('json')
  expect(call.prompt[0].content).toContain('agent_creator_agent')
  expect(JSON.stringify(call.prompt)).toContain(input.description)
})

test('creator rejects duplicate names before spending an LLM request', async () => {
  const { request, model, writes } = harness(instructions, true)
  expect((await request()).status).toBe(409)
  expect(model.doGenerateCalls).toHaveLength(0)
  expect(writes).toHaveLength(0)
})

test('creator rejects invalid generated instructions without saving or exposing provider output', async () => {
  for (const output of [{ purpose: '', rules: [] }, { purpose: 'x'.repeat(71), rules: ['secret-provider-output'] },
    { purpose: 'Research', rules: ['x'.repeat(6001)] }, { purpose: 'Research', rules: [7] }]) {
    const { request, writes } = harness(output)
    const response = await request()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Couldn’t generate this agent. Please try again.' })
    expect(writes).toHaveLength(0)
  }
})

test('creator validates descriptions and identity before database or LLM work', async () => {
  const { request, writes, lookups, model } = harness()
  for (const body of [null, [], {}, { ...input, description: ' ' }, { ...input, description: 'x'.repeat(6001) },
    { ...input, color: 'unknown' }, { ...input, name: 'x'.repeat(31) }]) {
    expect((await request(body)).status).toBe(400)
  }
  expect(writes).toHaveLength(0)
  expect(lookups).toHaveLength(0)
  expect(model.doGenerateCalls).toHaveLength(0)
  expect(parseAgentCreation({ ...input, model: 'override', rules: ['override'] })).not.toHaveProperty('model')
})

test('provider failures return a safe retryable error', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    throw new Error('secret-provider-detail')
  } })
  try {
    await generateAgentInstructions(input.description, model)
    throw new Error('Expected generation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException)
    expect((error as HTTPException).status).toBe(502)
    expect((error as Error).message).toBe('Couldn’t generate this agent. Please try again.')
  }
})
