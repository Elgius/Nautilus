import { HTTPException } from 'hono/http-exception'
import type { Database } from '../db'

export type RoomScope = { organizationId: string; roomId: string }
type Writer = Pick<Database, 'room'>
export const AGENT_LEASE_MS = 240_000

export async function acquireRoomWork(db: Writer, scope: RoomScope, token: string) {
  const now = new Date()
  const result = await db.room.updateMany({
    where: { id: scope.roomId, organizationId: scope.organizationId,
      OR: [{ agentWorkToken: null }, { agentWorkExpiresAt: { lte: now } }] },
    data: { agentWorkToken: token, agentWorkExpiresAt: new Date(now.getTime() + AGENT_LEASE_MS) },
  })
  return result.count === 1
}

export async function releaseRoomWork(db: Writer, scope: RoomScope, token: string) {
  await db.room.updateMany({ where: { id: scope.roomId, organizationId: scope.organizationId, agentWorkToken: token },
    data: { agentWorkToken: null, agentWorkExpiresAt: null } })
}

/** Call inside the SAME transaction as every persisted document mutation.
 * Updating the room row serializes this check with lease acquisition/release.
 * Agent tokens come from the coordinator, never from public request bodies.
 */
export async function guardRoomWrite(db: Writer, scope: RoomScope, token?: string) {
  const now = new Date()
  const result = await db.room.updateMany({
    where: { id: scope.roomId, organizationId: scope.organizationId,
      ...(token ? { agentWorkToken: token, agentWorkExpiresAt: { gt: now } }
        : { OR: [{ agentWorkToken: null }, { agentWorkExpiresAt: { lte: now } }] }) },
    data: { lastActivityAt: now },
  })
  if (result.count !== 1) throw new HTTPException(423, { message: token
    ? 'This agent run no longer owns the room. Its edits were not saved.'
    : 'Agents are working in this room. Documents are read-only until they finish.' })
}
