import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Database } from './db'
import type { AppEnv } from './index'

type Owner = { organizationId: string; userId: string }
export const hubIds = z.object({ id: z.uuid(), conversationId: z.uuid() })
const importedTurn = hubIds.extend({
  userId: z.string().min(1),
  agentId: z.string().min(1).max(200), createdAt: z.number().int().min(0).max(8.64e15),
  prompt: z.string().min(1).max(32000), reply: z.string().min(1),
})
const fields = { id: true, conversationId: true, prompt: true, reply: true, createdAt: true, conversation: { select: { agentId: true } } } as const
function present({ createdAt, conversation, ...turn }: { createdAt: Date; conversation: { agentId: string }; id: string; conversationId: string; prompt: string; reply: string }) {
  return { ...turn, agentId: conversation.agentId, createdAt: createdAt.getTime() }
}
export async function findTurn(db: Database, owner: Owner, id: string) {
  const row = await db.hubTurn.findUnique({ where: { organizationId_userId_id: { ...owner, id } }, select: fields })
  return row && present(row)
}
export async function saveTurn(db: Database, owner: Owner, turn: {
  id: string; conversationId: string; agentId: string; prompt: string; reply: string; createdAt?: number
}) {
  const { id, conversationId, agentId, prompt, reply, createdAt } = turn
  return db.$transaction(async (tx) => {
    const conversation = { ...owner, id: conversationId }
    await tx.hubConversation.createMany({ data: { ...conversation, agentId }, skipDuplicates: true })
    const existing = await tx.hubConversation.findUniqueOrThrow({ where: { organizationId_userId_id: conversation }, select: { agentId: true } })
    if (existing.agentId !== agentId) throw new HTTPException(409, { message: 'Conversation belongs to a different agent.' })
    await tx.hubTurn.createMany({ data: { ...owner, id, conversationId, prompt, reply, createdAt: createdAt === undefined ? undefined : new Date(createdAt) }, skipDuplicates: true })
    const saved = await tx.hubTurn.findUniqueOrThrow({ where: { organizationId_userId_id: { ...owner, id } }, select: fields })
    if (saved.conversationId !== conversationId || saved.prompt !== prompt) throw new HTTPException(409, { message: 'This turn ID is already in use.' })
    return present(saved)
  })
}

export const hubHistory = new Hono<AppEnv>()
hubHistory.get('/', async (c) => {
  const after = c.req.query('after')
  if (after && !z.uuid().safeParse(after).success) throw new HTTPException(400, { message: 'Invalid history cursor.' })
  const rows = await c.get('db').hubTurn.findMany({
    where: { organizationId: c.get('organizationId'), userId: c.get('session').user.id, ...(after && { id: { gt: after } }) },
    select: fields, orderBy: { id: 'asc' }, take: 51,
  })
  return c.json({ turns: rows.slice(0, 50).map(present), next: rows.length > 50 ? rows[49].id : null })
})
hubHistory.post('/', bodyLimit({ maxSize: 3 * 1024 * 1024 }), async (c) => {
  const input = importedTurn.safeParse(await c.req.json().catch(() => null))
  if (!input.success) throw new HTTPException(400, { message: 'Invalid saved conversation.' })
  const owner = { organizationId: c.get('organizationId'), userId: c.get('session').user.id }
  if (input.data.userId !== owner.userId) throw new HTTPException(403, { message: 'Sign in with the account that saved this chat.' })
  return c.json({ turn: await saveTurn(c.get('db'), owner, input.data) })
})
