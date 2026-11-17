import { createAgentModel } from './ai'
import { createAgentInterface, type AgentSkill } from './agent_interface'
import type { Bindings } from './env'
import type { PrivateAgentMessage, PrivateAgentProfile } from './private-room-agents'
import type { PipelineStage } from './agent-pipeline'
import { parseDocumentPreview } from '../../../shared/document-preview'
import type { AgentOperationIssue } from '../../../shared/agent-errors'
import { AgentRunError } from './skill-operation-error'

export async function* streamPrivateRoomAgent(env: Bindings, profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal, resolveModel = createAgentModel, skills: AgentSkill[] = [], options: { stage?: (stage: PipelineStage) => void; toolCallConcurrency?: number; steps?: number; timeout?: number; loggingContext?: Record<string, string>; onIssue?: (issue: AgentOperationIssue) => void; preview?: (toolCallId: string, input: string | null) => Promise<void> } = {}) {
  // Use one authoritative deadline so an SDK timer cannot race our error code.
  const agent = createAgentInterface(profile, resolveModel(env), skills, { ...options, externalDeadline: true })
  options.stage?.('model.started')
  const deadline = AbortSignal.timeout(options.timeout ?? 60_000)
  const activeSignal = AbortSignal.any([signal, deadline])
  const interruptionCode = () => deadline.aborted || signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError'
    ? 'RUN_TIMEOUT' : signal.aborted ? 'RUN_CANCELLED' : 'MODEL_STREAM_INTERRUPTED'
  let result
  try { result = await agent.stream({ messages, abortSignal: activeSignal }) }
  catch (error) { throw new AgentRunError(activeSignal.aborted ? interruptionCode() : 'MODEL_REQUEST_FAILED', { cause: error }) }
  let finished = false
  let firstDelta = true
  type Input = { text: string; sent: number; delivered?: string; delivery?: Promise<void>; failure?: { error: unknown } }
  const inputs = new Map<string, Input>()
  const failedPreviewDocuments = new Set<string>()
  const checkFailure = (input: Input) => { if (input.failure) throw input.failure.error }
  const sendPreview = (id: string, input: Input, force = false) => {
    if (!options.preview || input.delivery || input.delivered === input.text || (!force && Date.now() - input.sent < 120)) return
    checkFailure(input)
    // Incomplete IDs/keys are not renderable. Avoid a database round trip for
    // those prefixes, especially before the first text delta arrives.
    const draft = parseDocumentPreview(input.text)
    if (!draft || failedPreviewDocuments.has(draft.documentId)) return
    const text = input.text
    input.sent = Date.now()
    input.delivery = Promise.resolve().then(() => options.preview!(id, text))
      .then(() => { input.delivered = text })
      .catch((error: unknown) => { input.failure = { error } })
      .finally(() => { input.delivery = undefined })
  }
  const flushPreview = async (id: string, input: Input) => {
    await input.delivery
    checkFailure(input)
    sendPreview(id, input, true)
    await input.delivery
    checkFailure(input)
  }
  try {
    for await (const part of result.stream) {
      if (firstDelta && (part.type === 'text-delta' || part.type === 'tool-input-delta' || part.type === 'reasoning-delta')) {
        firstDelta = false; options.stage?.('model.first-delta')
      }
      if (part.type === 'tool-input-start' && (part.toolName === 'applyDocumentEdits' || part.toolName === 'proposeDocumentEdits')) inputs.set(part.id, { text: '', sent: 0 })
      if (part.type === 'tool-input-delta') {
        const input = inputs.get(part.id)
        if (input) {
          input.text += part.delta
          if (input.text.length > 200_000) { await input.delivery; inputs.delete(part.id); await options.preview?.(part.id, null) }
          // One in-flight delivery per tool, with only the latest cumulative input
          // retained. Slow authorization/socket I/O must not block model tokens.
          else sendPreview(part.id, input)
        }
      }
      if (part.type === 'tool-input-end') {
        const input = inputs.get(part.id)
        if (input) await flushPreview(part.id, input)
      }
      if ((part.type === 'tool-result' || part.type === 'tool-error') && inputs.has(part.toolCallId)) {
        const input = inputs.get(part.toolCallId)!
        await input.delivery
        const draft = parseDocumentPreview(input.text)
        // Subsequent recovery attempts may still execute, but must not repeatedly
        // paint and erase an uncommitted draft after an edit has already failed.
        if (part.type === 'tool-error' && draft) failedPreviewDocuments.add(draft.documentId)
        inputs.delete(part.toolCallId)
        await options.preview?.(part.toolCallId, null)
      }
      if (part.type === 'error') throw new AgentRunError('MODEL_REQUEST_FAILED', { cause: part.error })
      if (part.type === 'abort') throw new AgentRunError(interruptionCode())
      if (part.type === 'text-delta') yield part.text
      if (part.type === 'finish') {
        if (part.finishReason === 'length') throw new AgentRunError('MODEL_OUTPUT_LIMIT')
        if (part.finishReason === 'tool-calls') throw new AgentRunError('STEP_LIMIT_REACHED')
        finished = true
      }
    }
    if (!finished) throw new AgentRunError('MODEL_STREAM_INTERRUPTED')
  } catch (error) {
    if (activeSignal.aborted) throw new AgentRunError(interruptionCode(), { cause: error })
    throw error
  } finally {
    // Do not let an in-flight draft arrive after the queue's terminal rollback.
    await Promise.all([...inputs.values()].map((input) => input.delivery))
  }
}
