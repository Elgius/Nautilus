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

test('review instructions cover heading formatting after the requested section has been saved', async () => {
  const reviewer = model('{"approved":true,"reason":null}')
  const oldSection = 'Pacific Ocean\rAn existing section.'
  const heading = { paragraphId: 'pacific-heading', startIndex: oldSection.length + 14, paragraphStyle: {} }
  const candidate: EditReview = {
    documentId: 'doc', expectedVersionId: 'v5', kind: 'DOCUMENT', changeSummary: 'Style the Pacific Ocean heading',
    edits: [{ type: 'formatParagraph', paragraphId: 'pacific-heading', style: { namedStyleType: 4 } }],
    savedDocumentEdits: {
      baseVersionId: 'v4', savedVersionId: 'v5',
      edits: [{ type: 'insertText', index: oldSection.length, text: '\nPacific Ocean\nThe Pacific is the largest ocean.' }],
    },
    reads: [{ documentId: 'doc', currentVersionId: 'v5', kind: 'DOCUMENT', reads: [{ operation: 'readDocument', args: {}, result: {
      body: {
        dataStream: `${oldSection}\rPacific Ocean\rThe Pacific is the largest ocean.\r\n`,
        paragraphs: [{ paragraphId: 'existing-heading', startIndex: 13, paragraphStyle: {} }, heading],
      },
    } }] }],
  }
  await reviewDocumentEdit(reviewer, [{ role: 'user', content: 'Add a Pacific Ocean section and paragraph.' }], candidate, new AbortController().signal)
  const { prompt } = reviewer.doGenerateCalls[0]
  expect(prompt[0].content).toContain('A heading with matching text alone does not establish that the earlier batch inserted it.')
  const message = prompt.find(({ role }) => role === 'user')
  const part = message?.content.find(({ type }) => type === 'text')
  if (!part) throw new Error('Missing reviewer payload')
  const payload = JSON.parse(part.text)
  expect(payload.candidate.reads).toEqual(candidate.reads)
  expect(payload.candidate.savedDocumentEdits).toEqual(candidate.savedDocumentEdits)
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
