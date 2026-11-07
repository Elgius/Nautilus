import type { GenerateTextEndEvent, GenerateTextStartEvent, GenerateTextStepEndEvent, GenerateTextStepStartEvent, ToolExecutionEndEvent, ToolExecutionStartEvent } from 'ai'

/** Log metadata only: prompts, tool payloads and provider errors can contain private data. */
export function agentCallLogging(context: Record<string, string>) {
  const logId = crypto.randomUUID()
  let startedAt = Date.now()
  let ended = false
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
    onStart: ({ callId, modelId, provider }: GenerateTextStartEvent) => {
      startedAt = Date.now()
      ended = false
      log('call.started', { callId, modelId, provider })
    },
    onStepStart: ({ callId, stepNumber, modelId }: GenerateTextStepStartEvent) => log('step.started', { callId, stepNumber, modelId }),
    onStepError: ({ callId, stepNumber }: GenerateTextStepStartEvent) => end('call.failed', { callId, stepNumber }),
    onStepEnd: ({ callId, stepNumber, finishReason, usage }: GenerateTextStepEndEvent) => log(finishReason === 'error' ? 'step.failed' : 'step.completed', { callId, stepNumber, finishReason, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }),
    onToolExecutionStart: ({ callId, toolCall }: ToolExecutionStartEvent) => log('tool.started', { callId, toolCallId: toolCall.toolCallId, toolName: toolCall.toolName }),
    onToolExecutionEnd: ({ callId, toolCall, toolOutput, toolExecutionMs }: ToolExecutionEndEvent) => log(toolOutput.type === 'tool-error' ? 'tool.failed' : 'tool.completed', { callId, toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, durationMs: toolExecutionMs }),
    onEnd: ({ callId, finishReason, totalUsage }: GenerateTextEndEvent) => end(finishReason === 'error' ? 'call.failed' : 'call.completed', { callId, finishReason, inputTokens: totalUsage.inputTokens, outputTokens: totalUsage.outputTokens }),
    onError: () => end('call.failed'),
    onAbort: () => end('call.aborted'),
  }
}
