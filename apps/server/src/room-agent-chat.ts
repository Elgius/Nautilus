import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createAgentModel, createLLMAgent } from './ai'
import type { AppEnv } from './index'

// Mounted behind the room's authentication, organization, origin and existence checks.
export function createRoomAgentChat(resolveModel = createAgentModel) {
  const roomAgentChat = new Hono<AppEnv>()
  roomAgentChat.post('/:roomId/messages/:messageId/reply', async (c) => {
    const input = await c.req.json().catch(() => null)
    if (!input || typeof input.agentId !== 'string' || !input.agentId.trim()) {
      throw new HTTPException(400, { message: 'Choose an agent from this room.' })
    }
    const db = c.get('db'), organizationId = c.get('organizationId'), roomId = c.req.param('roomId')
    const assignment = await db.roomAgent.findFirst({
      where: { organizationId, roomId, agentId: input.agentId },
      select: { agent: { select: { id: true, name: true, role: true, rules: true } } },
    })
    if (!assignment) throw new HTTPException(404, { message: 'Agent not found in this room.' })
    const target = await db.roomMessage.findFirst({
      where: { organizationId, roomId, id: c.req.param('messageId'), authorUserId: c.get('session').user.id },
      select: { id: true, createdAt: true },
    })
    if (!target) throw new HTTPException(404, { message: 'Your message was not found in this room.' })
    const agent = createLLMAgent(assignment.agent, resolveModel(c.env))
    // Anchor history at the saved user message so concurrent later posts cannot leak into this turn.
    const rows = await db.roomMessage.findMany({
      where: { organizationId, roomId, OR: [
        { createdAt: { lt: target.createdAt } },
        { createdAt: target.createdAt, id: { lte: target.id } },
      ] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
      select: { text: true, authorAgentId: true, authorUser: { select: { name: true } }, authorAgent: { select: { name: true } } },
    })
    const messages: { role: 'user' | 'assistant'; content: string }[] = []
    let remaining = 32_000
    for (const row of rows) {
      const own = row.authorAgentId === assignment.agent.id
      const content = own ? row.text : `${row.authorUser?.name ?? row.authorAgent?.name ?? 'Participant'}: ${row.text}`
      if (content.length > remaining) break
      messages.unshift({ role: own ? 'assistant' : 'user', content })
      remaining -= content.length
    }
    let reply: string
    try {
      const result = await agent.generate({ messages, abortSignal: c.req.raw.signal })
      reply = result.text
      if (!reply.trim()) throw new Error('Empty response')
    } catch {
      throw new HTTPException(502, { message: 'Your message is saved, but the agent could not reply. Please try again.' })
    }
    // Keep the provider call outside the database transaction.
    const message = await db.$transaction(async (tx) => {
      const saved = await tx.roomMessage.create({
        data: { organizationId, roomId, authorAgentId: assignment.agent.id, text: reply },
        include: { authorUser: { select: { name: true } }, authorAgent: { select: { name: true } },
          documents: { select: { documentId: true, documentVersionId: true, document: { select: { title: true, kind: true } } } } },
      })
      await tx.room.update({ where: { id: roomId, organizationId }, data: { lastActivityAt: new Date() } })
      return saved
    })
    return c.json({ message }, 201)
  })
  return roomAgentChat
}

export const roomAgentChat = createRoomAgentChat()
