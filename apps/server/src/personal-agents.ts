import type { Database } from './db'
import { agentAppearanceSelect } from './agents'
import { canChat, scheduledTaskAvailable, type ChatIdentity } from './room-chat-service'

export const personalAgentScope = (organizationId: string, userId: string) => ({ organizationId, createdByUserId: userId })

/** Registration records use, never grants another member ownership of the agent. */
export async function registerPersonalRoomAgent(db: Database, identity: ChatIdentity, agentId: string) {
  if (!await canChat(db, identity) || !await scheduledTaskAvailable(db, identity)) return null
  return db.$transaction(async (tx) => {
    const agent = await tx.agent.findFirst({
      where: { id: agentId, ...personalAgentScope(identity.organizationId, identity.userId) },
      select: { ...agentAppearanceSelect, role: true, rules: true },
    })
    if (!agent) return null
    await tx.roomAgent.createMany({ data: { organizationId: identity.organizationId, roomId: identity.roomId,
      agentId, addedByUserId: identity.userId }, skipDuplicates: true })
    return agent
  })
}
