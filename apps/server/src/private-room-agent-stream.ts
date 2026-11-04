import { createAgentModel, createLLMAgent } from './ai'
import type { Bindings } from './env'
import type { PrivateAgentMessage, PrivateAgentProfile } from './private-room-agents'

export async function* streamPrivateRoomAgent(env: Bindings, profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal, resolveModel = createAgentModel) {
  const agent = createLLMAgent(profile, resolveModel(env))
  const result = await agent.stream({ messages, abortSignal: signal })
  let finished = false
  for await (const part of result.stream) {
    if (part.type === 'error' || part.type === 'abort') throw new Error('Agent stream failed')
    if (part.type === 'text-delta') yield part.text
    if (part.type === 'finish') finished = true
  }
  if (!finished) throw new Error('Agent stream interrupted')
}
