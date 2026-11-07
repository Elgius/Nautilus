import { createAgentModel } from './ai'
import { createAgentInterface, type AgentSkill } from './agent_interface'
import type { Bindings } from './env'
import type { PrivateAgentMessage, PrivateAgentProfile } from './private-room-agents'

export async function* streamPrivateRoomAgent(env: Bindings, profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal, resolveModel = createAgentModel, skills: AgentSkill[] = [], options: { steps?: number; timeout?: number; loggingContext?: Record<string, string>; preview?: (toolCallId: string, input: string | null) => Promise<void> } = {}) {
  const agent = createAgentInterface(profile, resolveModel(env), skills, options)
  const result = await agent.stream({ messages, abortSignal: signal })
  let finished = false
  const inputs = new Map<string, { text: string; sent: number }>()
  for await (const part of result.stream) {
    if (part.type === 'tool-input-start' && part.toolName === 'applyDocumentEdits') inputs.set(part.id, { text: '', sent: 0 })
    if (part.type === 'tool-input-delta') {
      const input = inputs.get(part.id)
      if (input) {
        input.text += part.delta
        if (input.text.length > 200_000) { inputs.delete(part.id); await options.preview?.(part.id, null) }
        else if (Date.now() - input.sent >= 120) {
          await options.preview?.(part.id, input.text)
          input.sent = Date.now()
        }
      }
    }
    if (part.type === 'tool-input-end') {
      const input = inputs.get(part.id)
      if (input) await options.preview?.(part.id, input.text)
    }
    if ((part.type === 'tool-result' || part.type === 'tool-error') && inputs.has(part.toolCallId)) {
      inputs.delete(part.toolCallId)
      await options.preview?.(part.toolCallId, null)
    }
    if (part.type === 'error' || part.type === 'abort') throw new Error('Agent stream failed')
    if (part.type === 'text-delta') yield part.text
    if (part.type === 'finish') finished = true
  }
  if (!finished) throw new Error('Agent stream interrupted')
}
