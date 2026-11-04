import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentMention, selectAgentMention } from '../lib/agent-mention'

test('@ opens an agent query at a word boundary without treating email addresses as instructions', () => {
  assert.deepEqual(agentMention('@'), { start: 0, query: '' })
  assert.deepEqual(agentMention('Hello @Sc summarize'), { start: 6, query: 'Sc' })
  assert.equal(agentMention('person@example.com'), null)
  assert.equal(agentMention('A normal message'), null)
})

test('choosing an agent keeps room text separate from the private instruction', () => {
  assert.deepEqual(selectAgentMention('Room draft @Scout summarize the document', 'Scout'), { roomDraft: 'Room draft', instruction: 'summarize the document' })
  assert.deepEqual(selectAgentMention('@Sc summarize privately', 'Scout'), { roomDraft: '', instruction: 'summarize privately' })
  assert.deepEqual(selectAgentMention('@Research Agent summarize', 'Research Agent'), { roomDraft: '', instruction: 'summarize' })
  assert.deepEqual(selectAgentMention('@ summarize this', 'Scout'), { roomDraft: '', instruction: 'summarize this' })
  assert.deepEqual(selectAgentMention('@SC', 'Scout'), { roomDraft: '', instruction: '' })
  assert.deepEqual(selectAgentMention('Keep this draft', 'Scout'), { roomDraft: 'Keep this draft', instruction: '' })
})
