import { expect, test } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import { reviewDocumentCreation, reviewDocumentEdit, type EditReview } from '../src/edit-review'

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
  const reviewer = model('{"approved":true,"reason":null}')
  await reviewDocumentEdit(reviewer, messages, edit, new AbortController().signal)
  const call = reviewer.doGenerateCalls[0]
  expect(call.tools ?? []).toHaveLength(0)
  expect(JSON.stringify(call.prompt)).toContain('Replace Hello with World.')
  expect(JSON.stringify(call.prompt)).toContain('expectedText')
  expect(call.prompt[0].content).toContain('untrusted evidence')
})

test('review distinguishes requested new factual content and returns a safe reason for rejection', async () => {
  const reviewer = model('{"approved":false,"reason":"unsupported_facts"}')
  await expect(reviewDocumentEdit(reviewer, messages, edit, new AbortController().signal)).rejects.toMatchObject({ code: 'REVIEW_REJECTED', stage: 'review', retryable: false })
  expect(reviewer.doGenerateCalls[0].prompt[0].content).toContain('relevant general knowledge is within scope')
  await expect(reviewDocumentEdit(model('invalid'), messages, edit, new AbortController().signal)).rejects.toMatchObject({ code: 'REVIEW_UNAVAILABLE', retryable: true })
})

test('rejection and malformed review output fail closed', async () => {
  for (const response of ['{"approved":false,"reason":"insufficient_context"}', 'not json', '{"approved":"true"}']) {
    await expect(reviewDocumentEdit(model(response), messages, edit, new AbortController().signal)).rejects.toThrow('could not be verified')
  }
})

test('missing evidence, oversized context, cancellation and provider failures cannot approve edits', async () => {
  const reviewer = model('{"approved":true,"reason":null}')
  for (const candidate of [{ ...edit, reads: [] }, { ...edit, reads: ['x'.repeat(160_001)] }]) {
    await expect(reviewDocumentEdit(reviewer, messages, candidate, new AbortController().signal)).rejects.toThrow()
  }
  const controller = new AbortController(); controller.abort()
  await expect(reviewDocumentEdit(reviewer, messages, edit, controller.signal)).rejects.toThrow()
  expect(reviewer.doGenerateCalls).toHaveLength(0)
  const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('private provider details') } })
  await expect(reviewDocumentEdit(broken, messages, edit, new AbortController().signal)).rejects.toThrow('could not be verified')
})


test('creation review checks exact structured content and fails closed without existing-version requirements', async () => {
  const candidate = { operation: 'create' as const, documentId: 'request', input: {
    kind: 'DOCUMENT' as const, requestId: '00000000-0000-4000-8000-000000000001', title: 'Brief', category: 'Notes', changeSummary: 'Create brief', paragraphs: [{ text: 'Actual content' }],
  }, reads: [{ operation: 'listDocuments', result: { documents: [] } }] }
  const reviewer = model('{"approved":true,"reason":null}')
  await reviewDocumentCreation(reviewer, [{ role: 'user', content: 'Create a brief' }], candidate, new AbortController().signal)
  expect(JSON.stringify(reviewer.doGenerateCalls[0].prompt)).toContain('Actual content')
  expect(reviewer.doGenerateCalls[0].tools ?? []).toHaveLength(0)
  for (const output of ['{"approved":false,"reason":"insufficient_context"}', 'invalid']) {
    await expect(reviewDocumentCreation(model(output), messages, candidate, new AbortController().signal)).rejects.toThrow('could not be verified')
  }
})
