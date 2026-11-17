import type { AgentRunContext, PrivateAgentMessage, PrivateAgentProfile } from '../../src/private-room-agents'
import type { AgentSkill } from '../../src/agent_interface'
let calls = 0
export function privateAgentCalls() { return calls }
export async function* streamPrivateRoomAgent(_env: unknown, _profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal, _resolveModel?: unknown, skills?: AgentSkill[], options?: { preview?: AgentRunContext['preview'] }) {
  calls++
  if (messages.at(-1)?.content === 'Check clarification availability') {
    const askUser = skills?.find(({ tools }) => tools.askUser)?.tools.askUser.execute
    if (askUser) await askUser({ question: 'Which document?' }, { toolCallId: 'question', messages, abortSignal: signal, context: undefined })
    else yield 'Clarification is unavailable.'
    return
  }
  await options?.preview?.('write', JSON.stringify({ documentId: 'doc', expectedVersionId: 'v1', edits: [{ type: 'insertText', index: 0, text: 'Partial ' + messages.at(-1)!.content }] }))
  yield 'Private reply: '
  await new Promise((resolve) => setTimeout(resolve, messages.at(-1)!.content === 'Slow write' ? 1200 : 400))
  signal.throwIfAborted()
  yield messages.at(-1)!.content
}
