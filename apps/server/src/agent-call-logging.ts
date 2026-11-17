import type { GenerateTextEndEvent, GenerateTextStartEvent, GenerateTextStepEndEvent, GenerateTextStepStartEvent, ToolExecutionEndEvent, ToolExecutionStartEvent } from 'ai'
import { SkillOperationError, errorDiagnostics } from './skill-operation-error'
import type { AgentOperationIssue } from '../../../shared/agent-errors'

/** Log metadata only: prompts, tool payloads and provider errors can contain private data. */
export function agentCallLogging(context: Record<string, string>, onIssue?: (issue: AgentOperationIssue) => void) {
  const logId = crypto.randomUUID()
  let startedAt = Date.now()
  let ended = false
  let awaitingResult = false
  let terminalDetails: Record<string, unknown> = {}
  const steps = new Map<string, number>()
  const log = (event: string, details: Record<string, unknown> = {}) => {
    const record = { timestamp: new Date().toISOString(), event, logId, ...context, ...details }
    if (event.endsWith('.failed')) console.error('[agent-call]', JSON.stringify(record))
    else console.info('[agent-call]', JSON.stringify(record))
  }
  const end = (event: string, details: Record<string, unknown> = {}) => {
    if (ended) return
    ended = true
    log(event, { durationMs: Date.now() - startedAt, ...details })
  }
  return {
    /** Await generation and caller validation before recording a terminal status. */
    async run<T>(action: () => Promise<T>): Promise<T> {
      awaitingResult = true
      try {
        const result = await action()
        end(terminalDetails.finishReason === 'error' ? 'call.failed' : 'call.completed', terminalDetails)
        return result
      } catch (error) {
        end('call.failed', { ...terminalDetails, ...errorDiagnostics(error) })
        throw error
      } finally {
        awaitingResult = false
      }
    },
    onStart: ({ callId, modelId, provider }: GenerateTextStartEvent) => {
      startedAt = Date.now()
      ended = false
      terminalDetails = { callId }
      steps.clear()
      log('call.started', { callId, modelId, provider })
    },
    onStepStart: ({ callId, stepNumber, modelId }: GenerateTextStepStartEvent) => {
      steps.set(`${callId}:${stepNumber}`, Date.now())
      log('step.started', { callId, stepNumber, modelId })
    },
    onStepError: ({ callId, stepNumber }: GenerateTextStepStartEvent) => {
      if (!awaitingResult) end('call.failed', { callId, stepNumber })
    },
    onStepEnd: ({ callId, stepNumber, finishReason, usage }: GenerateTextStepEndEvent) => {
      const key = `${callId}:${stepNumber}`, start = steps.get(key)
      steps.delete(key)
      log(finishReason === 'error' ? 'step.failed' : 'step.completed', { callId, stepNumber, finishReason,
        ...(start !== undefined ? { durationMs: Date.now() - start } : {}), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
    },
    onToolExecutionStart: ({ callId, toolCall }: ToolExecutionStartEvent) => log('tool.started', { callId, toolCallId: toolCall.toolCallId, toolName: toolCall.toolName }),
    onToolExecutionEnd: ({ callId, toolCall, toolOutput, toolExecutionMs }: ToolExecutionEndEvent) => {
      const issue: AgentOperationIssue | undefined = toolOutput.type !== 'tool-error' ? undefined : {
        code: toolOutput.error instanceof SkillOperationError ? toolOutput.error.code : 'OPERATION_FAILED',
        stage: toolOutput.error instanceof SkillOperationError ? toolOutput.error.stage : 'run',
        retryable: toolOutput.error instanceof SkillOperationError ? toolOutput.error.retryable : false,
        toolName: toolCall.toolName, toolCallId: toolCall.toolCallId,
        ...(toolOutput.error instanceof SkillOperationError && toolOutput.error.reason ? { reason: toolOutput.error.reason } : {}),
      }
      if (issue) onIssue?.(issue)
      log(toolOutput.type === 'tool-error' ? 'tool.failed' : 'tool.completed', {
      callId, toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, durationMs: toolExecutionMs,
      ...(issue ? { errorCode: issue.code, stage: issue.stage, retryable: issue.retryable, ...(issue.reason ? { reason: issue.reason } : {}) } : {}),
      ...(toolOutput.type === 'tool-error' ? errorDiagnostics(toolOutput.error) : {}),
    }) },
    onEnd: ({ callId, finishReason, totalUsage }: GenerateTextEndEvent) => {
      terminalDetails = { callId, finishReason, inputTokens: totalUsage.inputTokens, outputTokens: totalUsage.outputTokens }
      if (!awaitingResult) end(finishReason === 'error' ? 'call.failed' : 'call.completed', terminalDetails)
    },
    onError: ({ error }: { error: unknown }) => end('call.failed', errorDiagnostics(error)),
    onAbort: () => end('call.aborted'),
  }
}
