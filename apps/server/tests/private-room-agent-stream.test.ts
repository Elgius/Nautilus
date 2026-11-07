import { expect, test } from 'bun:test'
import { simulateReadableStream, tool } from 'ai'
import { z } from 'zod'
import { MockLanguageModelV4 } from 'ai/test'
import { streamPrivateRoomAgent } from '../src/private-room-agent-stream'
import type { Bindings } from '../src/env'
const profile = { id: 'scout', name: 'Scout', role: 'Research', rules: ['Keep replies concise'] }

test('document tool input streams before the write completes and closes after its result', async () => {
  const input = '{"documentId":"doc","expectedVersionId":"v1","edits":[{"type":"insertText","index":0,"text":"ocean"}]}'
  const split = input.indexOf('ocean') + 3
  let completed = false
  const previews: { input: string | null; completed: boolean }[] = []
  const usage = { inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 2, text: 2, reasoning: undefined } }
  const model = new MockLanguageModelV4({ doStream: [
    { stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: 'tool-input-start', id: 'write', toolName: 'applyDocumentEdits' },
      { type: 'tool-input-delta', id: 'write', delta: input.slice(0, split) },
      { type: 'tool-input-delta', id: 'write', delta: input.slice(split) },
      { type: 'tool-input-end', id: 'write' },
      { type: 'tool-call', toolCallId: 'write', toolName: 'applyDocumentEdits', input },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] }) },
    { stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: 'text-start', id: 'answer' }, { type: 'text-delta', id: 'answer', delta: 'Saved.' }, { type: 'text-end', id: 'answer' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ] }) },
  ] })
  const skills = [{ id: 'test-write', instructions: 'Write the document.', tools: {
    applyDocumentEdits: tool({ inputSchema: z.object({ documentId: z.string(), expectedVersionId: z.string(), edits: z.array(z.object({ type: z.literal('insertText'), index: z.number(), text: z.string() })) }), execute: async () => { completed = true; return { saved: true } } }),
  } }]
  let reply = ''
  for await (const delta of streamPrivateRoomAgent({} as Bindings, profile, [{ role: 'user', content: 'Write ocean' }], new AbortController().signal, () => model, skills, {
    preview: async (id, text) => { expect(id).toBe('write'); previews.push({ input: text, completed }) },
  })) reply += delta
  expect(reply).toBe('Saved.')
  expect(previews[0]).toEqual({ input: input.slice(0, split), completed: false })
  expect(previews.some((item) => item.input === input)).toBe(true)
  expect(previews.at(-1)).toEqual({ input: null, completed: true })
})

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
  expect(model.doStreamCalls[0].prompt[0].content).toContain('\"purpose\":\"Research\"')
  expect(model.doStreamCalls[0].prompt.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'PRIVATE_PROMPT' }] })
})

test('private streaming reports provider stream errors without exposing their details', async () => {
  const model = new MockLanguageModelV4({ doStream: { stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
    { type: 'error', error: new Error('SECRET_PROVIDER_DETAILS') },
  ] }) } })
  const consume = async () => { for await (const _ of streamPrivateRoomAgent({} as Bindings, profile, [{ role: 'user', content: 'PRIVATE_PROMPT' }], new AbortController().signal, () => model)) { /* consume */ } }
  await expect(consume()).rejects.toThrow('Agent stream failed')
})

test('private streaming executes skill calls through the interface before streaming the final reply', async () => {
  const { createOfficeSkills } = await import('../src/agent_interface')
  let reads = 0
  const skills = createOfficeSkills({
    authorize: async () => {}, list: async () => [],
    read: async () => { reads++; return { kind: 'SPREADSHEET', currentVersionId: 'v1', result: { sheets: [{ id: 'sheet-1' }] } } },
    edit: async () => { throw new Error('Unexpected edit') },
  }, new AbortController().signal)
  const usage = {
    inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 2, text: 2, reasoning: undefined },
  }
  const model = new MockLanguageModelV4({ doStream: [
    { stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: 'tool-call', toolCallId: 'read-1', toolName: 'readWorkbook', input: JSON.stringify({ documentId: 'book-1' }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] }) },
    { stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
      { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', delta: 'Found the workbook.' },
      { type: 'text-end', id: 'answer' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ] }) },
  ] })
  const chunks: string[] = []
  for await (const text of streamPrivateRoomAgent({} as Bindings, profile, [{ role: 'user', content: 'Read the workbook' }], new AbortController().signal, () => model, skills)) chunks.push(text)
  expect(chunks.join('')).toBe('Found the workbook.')
  expect(reads).toBe(1)
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('sheet-1')
})
