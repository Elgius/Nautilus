import type { Database } from './db'

export type ChatIdentity = { organizationId: string; roomId: string; userId: string; sessionId: string; name?: string }
export const chatInclude = {
  authorUser: { select: { name: true } }, authorAgent: { select: { name: true } },
  documents: { select: { documentId: true, documentVersionId: true, document: { select: { title: true, kind: true } } } },
} as const
export async function canChat(db: Database, identity: ChatIdentity) {
  const { organizationId, roomId, userId, sessionId } = identity
  const [session, member] = await Promise.all([
    db.session.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: new Date() } }, select: { id: true } }),
    db.roomMember.findFirst({ where: { organizationId, roomId, member: { userId, organizationId } }, select: { organizationMemberId: true } }),
  ])
  return session && member ? member : null
}
export function parseSend(input: Record<string, unknown>) {
  if (typeof input.clientMessageId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(input.clientMessageId)) throw new Error('Invalid message ID.')
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20_000) throw new Error('Enter a message up to 20,000 characters.')
  return { clientMessageId: input.clientMessageId, text: input.text.trim() }
}
export async function saveChatMessage(db: Database, identity: ChatIdentity, input: ReturnType<typeof parseSend>) {
  const { organizationId, roomId, userId: authorUserId } = identity
  return db.$transaction(async (tx) => {
    const existing = await tx.roomMessage.findFirst({ where: { organizationId, roomId, authorUserId, clientMessageId: input.clientMessageId }, include: chatInclude })
    if (existing) return existing
    // The room coordinator serializes writes. Make timestamps strictly increasing
    // so reconnect cursors cannot skip messages saved within the same millisecond.
    const latest = await tx.roomMessage.findFirst({ where: { organizationId, roomId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true } })
    const createdAt = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1))
    const message = await tx.roomMessage.create({ data: { organizationId, roomId, authorUserId, ...input, createdAt }, include: chatInclude })
    await tx.room.update({ where: { id: roomId, organizationId }, data: { lastActivityAt: createdAt } })
    return message
  })
}
export async function chatHistory(db: Database, identity: ChatIdentity, cursorId?: string, direction: 'before' | 'after' = 'before') {
  const scope = { organizationId: identity.organizationId, roomId: identity.roomId, authorAgentId: null, authorUserId: { not: null } }
  const cursor = cursorId ? await db.roomMessage.findFirst({ where: { ...scope, id: cursorId }, select: { id: true, createdAt: true } }) : null
  if (cursorId && !cursor) throw new Error('Invalid history cursor.')
  const comparison = direction === 'after' ? 'gt' : 'lt'
  const order = direction === 'after' ? 'asc' : 'desc'
  const rows = await db.roomMessage.findMany({ where: { ...scope, ...(cursor ? { OR: [
    { createdAt: { [comparison]: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { [comparison]: cursor.id } },
  ] } : {}) }, include: chatInclude, orderBy: [{ createdAt: order }, { id: order }], take: 101 })
  const page = rows.slice(0, 100)
  const nextCursor = rows.length > 100 ? page[page.length - 1].id : null
  return { messages: direction === 'before' ? page.reverse() : page, nextCursor }
}
