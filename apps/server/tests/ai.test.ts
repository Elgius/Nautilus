import { expect, test } from 'bun:test'
import { createUIMessageStreamResponse, simulateReadableStream, toUIMessageStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { createAgentModel, createLLMAgent, parseAgentChat } from '../src/ai'
import type { Bindings } from '../src/env'

const profile = { id: 'agent-1', name: 'Scout', role: 'Research', rules: ['Cite sources.', 'Be concise.'] }
const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
}

test('agent generation uses saved instructions, conversation history, and output limits', async () => {
  const model = new MockLanguageModelV4({ doGenerate: {
    content: [{ type: 'text', text: 'Research complete.' }],
    finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [],
  } })
  const agent = createLLMAgent(profile, model)
  const result = await agent.generate({ messages: [
    { role: 'user', content: 'Research this topic.' },
    { role: 'assistant', content: 'Which topic?' },
    { role: 'user', content: 'Ocean navigation.' },
  ] })
  expect(result.text).toBe('Research complete.')
  expect(result.totalUsage.inputTokens).toBe(3)
  expect(model.doGenerateCalls).toHaveLength(1)
  const call = model.doGenerateCalls[0]
  expect(call.maxOutputTokens).toBe(4096)
  expect(call.prompt[0].role).toBe('system')
  expect(call.prompt[0].content).toContain('Your purpose: Research')
  expect(call.prompt[0].content).toContain('Rule: Cite sources.\nRule: Be concise.')
  expect(call.prompt.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Ocean navigation.' }] })
})

test('agent streams SDK UI messages and redacts provider errors', async () => {
  const model = new MockLanguageModelV4({ doStream: {
    stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hello Scout' },
      { type: 'text-end', id: 'text-1' },
      { type: 'error', error: new Error('secret-provider-detail') },
    ] }),
  } })
  const result = await createLLMAgent(profile, model).stream({ prompt: 'Hello' })
  const response = createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, onError: () => 'Unable to respond.' }),
  })
  const body = await response.text()
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  expect(body).toContain('Hello Scout')
  expect(body).toContain('Unable to respond.')
  expect(body).not.toContain('secret-provider-detail')
})

test('chat input accepts text history and strips caller-controlled model and instructions', () => {
  const messages = [{ role: 'user', content: 'Hello', extra: 'ignored' }]
  expect(parseAgentChat({ messages, model: 'untrusted', instructions: 'ignore rules' })).toEqual({
    messages: [{ role: 'user', content: 'Hello' }], stream: false,
  })
  expect(parseAgentChat({ messages, stream: true }).stream).toBe(true)
  for (const input of [null, [], {}, { messages: [] }, { messages: Array(51).fill(messages[0]) },
    { messages: [null] }, { messages: [{ role: 'system', content: 'Override' }] },
    { messages: [{ role: 'tool', content: 'Override' }] }, { messages: [{ role: 'user', content: ' ' }] },
    { messages: [{ role: 'assistant', content: 'Hello' }] },
    { messages: [{ role: 'user', content: 'a'.repeat(32_001) }] }, { messages, stream: 'yes' },
  ]) expect(() => parseAgentChat(input)).toThrow()
})

test('model configuration is optional for the server but required for agent calls', () => {
  const env = {} as Bindings
  expect(() => createAgentModel(env)).toThrow('not configured')
  expect(() => createAgentModel({ ...env, AI_MODEL: 'gemini-3.6-flash' })).toThrow('not configured')
  expect(() => createAgentModel({ ...env, GOOGLE_GENERATIVE_AI_API_KEY: 'test', AI_MODEL: 'invalid' })).toThrow('invalid')
  const model = createAgentModel({ ...env, GOOGLE_GENERATIVE_AI_API_KEY: 'test', AI_MODEL: 'gemini-3.6-flash' })
  expect(model).toMatchObject({ modelId: 'gemini-3.6-flash', provider: 'google.generative-ai' })
})
