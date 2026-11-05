import { expect, test } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import { reviewDocumentEdit, type EditReview } from '../src/edit-review'

const messages = [{ role: 'user' as const, content: 'Replace Hello with World.' }]
const edit: EditReview = { documentId: 'doc', expectedVersionId: 'v1', kind: 'DOCUMENT', changeSummary: 'Greeting',
  edits: [{ type: 'replaceText', start: 0, end: 5, expectedText: 'Hello', text: 'World' }], reads: [{ text: 'Hello' }] }
function model(text: string) {
  return new MockLanguageModelV4({ doGenerate: { content: [{ type: 'text', text }], warnings: [],
    finishReason: { unified: 'stop', raw: undefined }, usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    } } })
}

test('review uses original conversation and exact operations with no tools or custom profile', async () => {
  const reviewer = model('{"approved":true}')
  await reviewDocumentEdit(reviewer, messages, edit, new AbortController().signal)
  const call = reviewer.doGenerateCalls[0]
  expect(call.tools ?? []).toHaveLength(0)
  expect(JSON.stringify(call.prompt)).toContain('Replace Hello with World.')
  expect(JSON.stringify(call.prompt)).toContain('expectedText')
  expect(call.prompt[0].content).toContain('untrusted evidence')
})

test('rejection and malformed review output fail closed', async () => {
  for (const response of ['{"approved":false}', 'not json', '{"approved":"true"}']) {
    await expect(reviewDocumentEdit(model(response), messages, edit, new AbortController().signal)).rejects.toThrow('could not be verified')
  }
})

test('missing evidence, oversized context, cancellation and provider failures cannot approve edits', async () => {
  const reviewer = model('{"approved":true}')
  for (const candidate of [{ ...edit, reads: [] }, { ...edit, reads: ['x'.repeat(160_001)] }]) {
    await expect(reviewDocumentEdit(reviewer, messages, candidate, new AbortController().signal)).rejects.toThrow()
  }
  const controller = new AbortController(); controller.abort()
  await expect(reviewDocumentEdit(reviewer, messages, edit, controller.signal)).rejects.toThrow()
  expect(reviewer.doGenerateCalls).toHaveLength(0)
  const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('private provider details') } })
  await expect(reviewDocumentEdit(broken, messages, edit, new AbortController().signal)).rejects.toThrow('could not be verified')
})
