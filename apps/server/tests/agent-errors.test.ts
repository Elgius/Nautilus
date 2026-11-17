import { expect, test } from 'bun:test'
import { agentRunErrorMessage } from '../../../shared/agent-errors'
import { AgentRunError, errorDiagnostics } from '../src/skill-operation-error'

test('timeout messages are generated from the code and committed batch count', () => {
  expect(agentRunErrorMessage('RUN_TIMEOUT', 4)).toBe('The agent ran out of time. 4 edit batches were saved. Continue to finish the remaining sections.')
  expect(agentRunErrorMessage('RUN_TIMEOUT', 1)).toContain('1 edit batch was saved.')
  expect(agentRunErrorMessage('RUN_TIMEOUT', 0)).not.toContain('saved')
})

test('diagnostics retain error types and status without provider text, URLs or credentials', () => {
  const cause = Object.assign(new Error('SECRET response body https://secret.example'), { statusCode: 429 })
  const error = new AgentRunError('MODEL_REQUEST_FAILED', { cause })
  expect(errorDiagnostics(cause)).toMatchObject({ providerStatus: 429, errorType: 'Error' })
  expect(errorDiagnostics(error)).toMatchObject({ causeCode: 'MODEL_REQUEST_FAILED', causeType: 'Error' })
  expect(JSON.stringify(errorDiagnostics(error))).not.toContain('SECRET')
})
