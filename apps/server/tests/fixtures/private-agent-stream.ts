import type { PrivateAgentMessage, PrivateAgentProfile } from '../../src/private-room-agents'
let calls = 0
export function privateAgentCalls() { return calls }
export async function* streamPrivateRoomAgent(_env: unknown, _profile: PrivateAgentProfile, messages: PrivateAgentMessage[], signal: AbortSignal) {
  calls++
  yield 'Private reply: '
  await new Promise((resolve) => setTimeout(resolve, 400))
  signal.throwIfAborted()
  yield messages.at(-1)!.content
}
