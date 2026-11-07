import { createAgentModel } from './ai'
import { createAgentInterface, type AgentSkill } from './agent_interface'
import type { Bindings } from './env'
import type { PrivateAgentMessage, PrivateAgentProfile } from './private-room-agents'

export async function* streamPrivateRoomAgent(env: Bindings, profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal, resolveModel = createAgentModel, skills: AgentSkill[] = [], options: { steps?: number; timeout?: number; loggingContext?: Record<string, string> } = {}) {
  const agent = createAgentInterface(profile, resolveModel(env), skills, options)
  const result = await agent.stream({ messages, abortSignal: signal })
  let finished = false
  for await (const part of result.stream) {
    if (part.type === 'error' || part.type === 'abort') throw new Error('Agent stream failed')
    if (part.type === 'text-delta') yield part.text
    if (part.type === 'finish') finished = true
  }
  if (!finished) throw new Error('Agent stream interrupted')
}
