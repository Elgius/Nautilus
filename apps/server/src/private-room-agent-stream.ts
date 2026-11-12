import { createAgentModel } from './ai'
import { createAgentInterface, type AgentSkill } from './agent_interface'
import type { Bindings } from './env'
import type { PrivateAgentMessage, PrivateAgentProfile } from './private-room-agents'
import { parseDocumentPreview } from '../../../shared/document-preview'

export async function* streamPrivateRoomAgent(env: Bindings, profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal, resolveModel = createAgentModel, skills: AgentSkill[] = [], options: { steps?: number; timeout?: number; loggingContext?: Record<string, string>; preview?: (toolCallId: string, input: string | null) => Promise<void> } = {}) {
  const agent = createAgentInterface(profile, resolveModel(env), skills, options)
  const result = await agent.stream({ messages, abortSignal: signal })
  let finished = false
  type Input = { text: string; sent: number; delivered?: string; delivery?: Promise<void>; failure?: { error: unknown } }
  const inputs = new Map<string, Input>()
  const checkFailure = (input: Input) => { if (input.failure) throw input.failure.error }
  const sendPreview = (id: string, input: Input, force = false) => {
    if (!options.preview || input.delivery || input.delivered === input.text || (!force && Date.now() - input.sent < 120)) return
    checkFailure(input)
    // Incomplete IDs/keys are not renderable. Avoid a database round trip for
    // those prefixes, especially before the first text delta arrives.
    if (!parseDocumentPreview(input.text)) return
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
        await inputs.get(part.toolCallId)!.delivery
        inputs.delete(part.toolCallId)
        await options.preview?.(part.toolCallId, null)
      }
      if (part.type === 'error' || part.type === 'abort') throw new Error('Agent stream failed')
      if (part.type === 'text-delta') yield part.text
      if (part.type === 'finish') finished = true
    }
    if (!finished) throw new Error('Agent stream interrupted')
  } finally {
    // Do not let an in-flight draft arrive after the queue's terminal rollback.
    await Promise.all([...inputs.values()].map((input) => input.delivery))
  }
}
