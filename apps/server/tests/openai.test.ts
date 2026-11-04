import { expect, spyOn, test } from 'bun:test'
import { createUIMessageStreamResponse, toUIMessageStream } from 'ai'
import { createAgentModel, createLLMAgent } from '../src/ai'
import { generateAgentInstructions } from '../src/agent-creator'
import { generateAvatarPreview } from '../src/avatar-generation'
import { streamPrivateRoomAgent } from '../src/private-room-agent-stream'
import type { Bindings } from '../src/env'
import type { AvatarDesign } from '../../../shared/avatar-design'

type ProviderRequest = {
  model: string; store: boolean; max_output_tokens: number; input: unknown
  text: { format: { schema: { additionalProperties: boolean; properties: { eyes: unknown } } } }
}

// Exercise the real provider adapter without credentials or paid API requests.
const env = { OPENAI_API_KEY: 'test-key', LLM_MODEL: 'gpt-test' } as Bindings
const profile = { id: 'scout', name: 'Scout', role: 'Research', rules: ['Cite sources.'] }
const usage = { input_tokens: 3, output_tokens: 2, total_tokens: 5 }
const avatar: AvatarDesign = {
  bodyPath: 'M 22 9 L 78 9 Q 91 9 91 22 L 91 78 Q 91 91 78 91 L 22 91 Q 9 91 9 78 L 9 22 Q 9 9 22 9 Z',
  color: '#9c5bfa', eyes: [{ cx: 38, cy: 56, rx: 5, ry: 7 }, { cx: 64, cy: 56, rx: 5, ry: 7 }],
}

function mockFetch(handler: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>) {
  return spyOn(globalThis, 'fetch').mockImplementation(Object.assign(handler, { preconnect: globalThis.fetch.preconnect }))
}

function providerResponse(text: string) {
  return Response.json({
    id: 'resp_test', model: env.LLM_MODEL, created_at: 1, status: 'completed', usage,
    output: [{ type: 'message', id: 'msg_test', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
  })
}

test('OpenAI requests preserve chat and structured generation contracts with storage disabled', async () => {
  const instructions = { purpose: 'Research', rules: ['Cite sources.'] }
  const outputs = ['Hello Scout', JSON.stringify(instructions), JSON.stringify(avatar)]
  const requests: ProviderRequest[] = []
  const fetch = mockFetch(async (url, init) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
    requests.push(JSON.parse(String(init?.body)))
    const output = outputs.shift()
    if (output === undefined) throw new Error('Unexpected provider request')
    return providerResponse(output)
  })
  try {
    const model = createAgentModel(env)
    const result = await createLLMAgent(profile, model).generate({ messages: [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Hello' },
    ] })
    expect(result.text).toBe('Hello Scout')
    expect(result.totalUsage.inputTokens).toBe(3)
    expect(await generateAgentInstructions('Research vendors', model)).toEqual(instructions)
    expect(await generateAvatarPreview('A purple cat', model)).toEqual(avatar)
    for (const request of requests) {
      expect(request.model).toBe('gpt-test')
      expect(request.store).toBe(false)
      expect(request.max_output_tokens).toBe(4096)
      expect(request).not.toHaveProperty('previous_response_id')
    }
    expect(JSON.stringify(requests[0].input)).toContain('Earlier answer')
    expect(JSON.stringify(requests[0].input)).toContain('Rule: Cite sources.')
    for (const [index, name] of [[1, 'agent_instructions'], [2, 'avatar_preview']] as const) {
      expect(requests[index].text.format).toMatchObject({ type: 'json_schema', name, strict: true })
      expect(requests[index].text.format.schema.additionalProperties).toBe(false)
    }
    expect(requests[2].text.format.schema.properties.eyes).toMatchObject({ minItems: 2, maxItems: 2 })
  } finally { fetch.mockRestore() }
})

test('OpenAI streaming translates to both the existing UI stream and private room text', async () => {
  const fetch = mockFetch(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    expect(request.stream).toBe(true)
    expect(request.store).toBe(false)
    const events = [
      { type: 'response.created', response: { id: 'resp_test', model: 'gpt-test', created_at: 1 } },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_test' } },
      { type: 'response.output_text.delta', item_id: 'msg_test', output_index: 0, delta: 'Hello Scout' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_test' } },
      { type: 'response.completed', response: { usage } },
    ]
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  })
  try {
    const result = await createLLMAgent(profile, createAgentModel(env)).stream({ prompt: 'Hello' })
    const response = createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })
    const body = await response.text()
    expect(body).toContain('Hello Scout')
    expect(body).toContain('"type":"finish"')
    expect(body).not.toContain('"type":"error"')
    const chunks: string[] = []
    for await (const text of streamPrivateRoomAgent(env, profile, [{ role: 'user', content: 'Hello privately' }], new AbortController().signal)) chunks.push(text)
    expect(chunks.join('')).toBe('Hello Scout')
  } finally { fetch.mockRestore() }
})

test('OpenAI HTTP quota and throttling errors retain safe avatar classifications without retries', async () => {
  for (const code of ['insufficient_quota', 'rate_limit_exceeded']) {
    const fetch = mockFetch(async () => Response.json({
      error: { message: 'private provider account details', type: code, code, param: null },
    }, { status: 429, headers: { 'retry-after': '12' } }))
    try {
      await expect(generateAvatarPreview('A cat', createAgentModel(env))).rejects.toMatchObject({
        status: 429, quotaExhausted: code === 'insufficient_quota', retryAfterSeconds: 12,
      })
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally { fetch.mockRestore() }
  }
})

test('OpenAI refusals and incomplete JSON fail safely in structured generation', async () => {
  for (const content of [
    [{ type: 'refusal', refusal: 'private provider refusal details' }],
    [{ type: 'output_text', text: '{"purpose":', annotations: [] }],
  ]) {
    const fetch = mockFetch(async () => Response.json({
      id: 'resp_test', model: 'gpt-test', status: 'incomplete', usage,
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', id: 'msg_test', role: 'assistant', content }],
    }))
    try {
      await expect(generateAgentInstructions('Research', createAgentModel(env))).rejects.toMatchObject({
        status: 502, message: 'Couldn’t generate this agent. Please try again.',
      })
      await expect(generateAvatarPreview('A cat', createAgentModel(env))).rejects.toMatchObject({ status: 502 })
    } finally { fetch.mockRestore() }
  }
})
