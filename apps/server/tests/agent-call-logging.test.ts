import { expect, spyOn, test } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import { reviewDocumentEdit, type EditReview } from '../src/edit-review'
import { generateRoomSuggestions } from '../src/room-suggestions'
import { agentCallLogging } from '../src/agent-call-logging'
import { SkillOperationError } from '../src/skill-operation-error'

const edit: EditReview = {
  documentId: 'doc', expectedVersionId: 'v1', kind: 'DOCUMENT', changeSummary: 'Greeting',
  edits: [{ type: 'replaceText', start: 0, end: 5, expectedText: 'Hello', text: 'World' }], reads: [{ text: 'Hello' }],
}
const suggestions = { suggestions: ['Compare the options', 'Summarize next steps', 'Draft a checklist'] }

test('tool failures log safe codes and stages without messages, payloads or provider secrets', async () => {
  for (const error of [new SkillOperationError('OFFICE_REJECTED', 'office', 'private-document-text'), new Error('private-provider-secret')]) {
    const { records } = await capture(async () => {
      const logging = agentCallLogging({ runId: 'run' })
      logging.onToolExecutionEnd({ callId: 'call', toolCall: { toolCallId: 'write', toolName: 'applyDocumentEdits', input: { secret: 'private-payload' } }, toolOutput: { type: 'tool-error', toolCallId: 'write', toolName: 'applyDocumentEdits', input: {}, error }, toolExecutionMs: 10 } as Parameters<typeof logging.onToolExecutionEnd>[0])
    })
    expect(records[0]).toMatchObject({ event: 'tool.failed', errorCode: error instanceof SkillOperationError ? 'OFFICE_REJECTED' : 'OPERATION_FAILED', stage: error instanceof SkillOperationError ? 'office' : 'unknown' })
    expect(JSON.stringify(records)).not.toContain('private-')
  }
})
function model(text: string, finishReason: 'stop' | 'tool-calls' = 'stop') {
  return new MockLanguageModelV4({ doGenerate: {
    content: text ? [{ type: 'text', text }] : [], warnings: [],
    finishReason: { unified: finishReason, raw: undefined },
    usage: {
      inputTokens: { total: 2, noCache: 2, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 3, text: 3, reasoning: undefined },
    },
  } })
}

async function capture(action: () => Promise<unknown>) {
  const records: Record<string, unknown>[] = []
  const collect = (label: unknown, record: unknown) => {
    if (label === '[agent-call]') records.push(JSON.parse(String(record)))
  }
  const info = spyOn(console, 'info').mockImplementation(collect)
  const error = spyOn(console, 'error').mockImplementation(collect)
  try {
    let rejected = false
    try { await action() } catch { rejected = true }
    return { records, rejected }
  } finally { info.mockRestore(); error.mockRestore() }
}

for (const kind of ['edit-review', 'room-suggestions'] as const) {
  const generate = (reviewer: MockLanguageModelV4) => kind === 'edit-review'
    ? reviewDocumentEdit(reviewer, [{ role: 'user', content: 'Replace Hello with World.' }], edit, new AbortController().signal)
    : generateRoomSuggestions([], reviewer)

  test(`${kind} logs success once after valid structured output`, async () => {
    const { records, rejected } = await capture(() => generate(model(JSON.stringify(kind === 'edit-review' ? { approved: true, reason: null } : suggestions))))
    expect(rejected).toBe(false)
    const terminal = records.filter(({ event }) => ['call.completed', 'call.failed', 'call.aborted'].includes(String(event)))
    expect(terminal).toHaveLength(1)
    expect(terminal[0]).toMatchObject({ event: 'call.completed', kind, inputTokens: 2, outputTokens: 3, finishReason: 'stop' })
    expect(terminal[0].callId).toBe(records[0].callId)
    expect(terminal[0].logId).toBe(records[0].logId)
    expect(terminal[0].durationMs).toBeNumber()
  })

  test(`${kind} logs failure once for parsing, validation, missing output and provider errors`, async () => {
    const invalid = kind === 'edit-review' ? '{"approved":"true"}' : JSON.stringify({ suggestions: ['Ask @Scout', 'Second prompt', 'Third prompt'] })
    const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('private-provider-secret') } })
    for (const reviewer of [model('not json'), model(invalid), model('', 'tool-calls'), broken]) {
      const { records, rejected } = await capture(() => generate(reviewer))
      expect(rejected).toBe(true)
      const terminal = records.filter(({ event }) => ['call.completed', 'call.failed', 'call.aborted'].includes(String(event)))
      expect(terminal).toHaveLength(1)
      expect(terminal[0]).toMatchObject({ event: 'call.failed', kind })
      expect(terminal[0].callId).toBe(records[0].callId)
      expect(JSON.stringify(records)).not.toContain('private-provider-secret')
      expect(JSON.stringify(records)).not.toContain(invalid)
    }
  })
}
