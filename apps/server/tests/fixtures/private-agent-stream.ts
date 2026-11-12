import type { AgentRunContext, PrivateAgentMessage, PrivateAgentProfile } from '../../src/private-room-agents'
let calls = 0
export function privateAgentCalls() { return calls }
export async function* streamPrivateRoomAgent(_env: unknown, _profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal, _resolveModel?: unknown, _skills?: unknown, options?: { preview?: AgentRunContext['preview'] }) {
  calls++
  await options?.preview?.('write', JSON.stringify({ documentId: 'doc', expectedVersionId: 'v1', edits: [{ type: 'insertText', index: 0, text: 'Partial ' + messages.at(-1)!.content }] }))
  yield 'Private reply: '
  await new Promise((resolve) => setTimeout(resolve, 400))
  signal.throwIfAborted()
  yield messages.at(-1)!.content
}
