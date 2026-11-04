import { expect, test } from 'bun:test'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { streamPrivateRoomAgent } from '../src/private-room-agent-stream'
import type { Bindings } from '../src/env'
const profile = { id: 'scout', name: 'Scout', role: 'Research', rules: ['Keep replies concise'] }

test('private streaming uses the selected agent’s profile and only supplied private messages', async () => {
  const model = new MockLanguageModelV4({ doStream: {
    stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Private ' },
      { type: 'text-delta', id: 'text-1', delta: 'answer' },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: {
        inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 2, text: 2, reasoning: undefined },
      } },
    ] }),
  } })
  const chunks: string[] = []
  for await (const text of streamPrivateRoomAgent({} as Bindings, profile, [{ role: 'user', content: 'PRIVATE_PROMPT' }], new AbortController().signal, () => model)) chunks.push(text)
  expect(chunks).toEqual(['Private ', 'answer'])
  expect(model.doStreamCalls[0].prompt[0]).toMatchObject({ role: 'system' })
  expect(model.doStreamCalls[0].prompt[0].content).toContain('Your purpose: Research')
  expect(model.doStreamCalls[0].prompt.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'PRIVATE_PROMPT' }] })
})

test('private streaming reports provider stream errors without exposing their details', async () => {
  const model = new MockLanguageModelV4({ doStream: { stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
    { type: 'error', error: new Error('SECRET_PROVIDER_DETAILS') },
  ] }) } })
  const consume = async () => { for await (const _ of streamPrivateRoomAgent({} as Bindings, profile, [{ role: 'user', content: 'PRIVATE_PROMPT' }], new AbortController().signal, () => model)) { /* consume */ } }
  await expect(consume()).rejects.toThrow('Agent stream failed')
})
