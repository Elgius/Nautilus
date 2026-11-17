import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Database } from './db'
import type { AppEnv } from './index'

type Owner = { organizationId: string; userId: string }
export function hubOwner(c: Context<AppEnv>) {
  const userId = c.get('session').user.id
  if (c.req.header('X-Hub-User') !== userId) throw new HTTPException(403, { message: 'Your session changed. Reload the workspace.' })
  return { organizationId: c.get('organizationId'), userId }
}

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
type InputTurn = { id: string; conversationId: string; agentId: string; prompt: string; reply: string; createdAt?: number }

// A claim and its final reply share the same unique turn key. A crashed worker's
// claim can be taken over after its provider timeout, fenced by a fresh token.
export const generationTimeoutMs = 120_000
export async function reserveTurn(db: Database, owner: Owner, turn: InputTurn, claimToken: string | null) {
  const { id, conversationId, agentId, prompt, reply, createdAt } = turn
  return db.$transaction(async (tx) => {
    const conversation = { ...owner, id: conversationId }
    await tx.hubConversation.createMany({ data: { ...conversation, agentId }, skipDuplicates: true })
    const existing = await tx.hubConversation.findUniqueOrThrow({ where: { organizationId_userId_id: conversation }, select: { agentId: true } })
    if (existing.agentId !== agentId) throw new HTTPException(409, { message: 'Conversation belongs to a different agent.' })
    const key = { ...owner, id }
    const inserted = await tx.hubTurn.createMany({ data: { ...key, conversationId, prompt, reply, claimToken, createdAt: createdAt === undefined ? undefined : new Date(createdAt) }, skipDuplicates: true })
    if (claimToken && inserted.count) return null
    const saved = await tx.hubTurn.findUniqueOrThrow({ where: { organizationId_userId_id: key }, select: { ...fields, claimToken: true } })
    if (saved.conversationId !== conversationId || saved.prompt !== prompt) throw new HTTPException(409, { message: 'This turn ID is already in use.' })
    if (saved.claimToken) {
      const cutoff = new Date(Date.now() - generationTimeoutMs - 30_000)
      if (claimToken && saved.createdAt < cutoff) {
        const acquired = await tx.hubTurn.updateMany({ where: { ...key, claimToken: saved.claimToken, createdAt: { lt: cutoff } }, data: { claimToken, createdAt: new Date() } })
        if (acquired.count) return null
      }
      throw new HTTPException(409, { message: 'This message is already being answered. Retry shortly.' })
    }
    return present({ id, conversationId, prompt, reply: saved.reply, createdAt: saved.createdAt, conversation: saved.conversation })
  })
}

export const hubHistory = new Hono<AppEnv>()
hubHistory.get('/', async (c) => {
  const owner = hubOwner(c)
  const after = c.req.query('after')
  const [time, id] = after?.split(',') ?? []
  if (after && (!z.uuid().safeParse(id).success || !/^\d{1,15}$/.test(time))) throw new HTTPException(400, { message: 'Invalid history cursor.' })
  const before = after ? new Date(Number(time)) : null
  const rows = await c.get('db').$queryRaw<{ id: string; agentId: string; title: string; preview: string; lastId: string; updatedAt: Date }[]>`
    SELECT c.id, c."agentId", left(first.prompt, 160) AS title, left(last.reply, 160) AS preview,
           last.id AS "lastId", last."createdAt" AS "updatedAt"
    FROM "hubConversation" c
    CROSS JOIN LATERAL (
      SELECT t.prompt FROM "hubTurn" t WHERE (t."organizationId", t."userId", t."conversationId") = (c."organizationId", c."userId", c.id)
        AND t."claimToken" IS NULL ORDER BY t."createdAt", t.id LIMIT 1
    ) first
    CROSS JOIN LATERAL (
      SELECT t.id, t.reply, t."createdAt" FROM "hubTurn" t WHERE (t."organizationId", t."userId", t."conversationId") = (c."organizationId", c."userId", c.id)
        AND t."claimToken" IS NULL ORDER BY t."createdAt" DESC, t.id DESC LIMIT 1
    ) last
    WHERE c."organizationId" = ${owner.organizationId} AND c."userId" = ${owner.userId}
      AND (${before}::timestamp IS NULL OR (last."createdAt", c.id) < (${before}::timestamp, ${id ?? null}::uuid))
    ORDER BY last."createdAt" DESC, c.id DESC LIMIT 51`
  const summaries = rows.slice(0, 50).map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() }))
  const tail = summaries.at(-1)
  return c.json({ summaries, next: rows.length > 50 && tail ? `${tail.updatedAt},${tail.id}` : null })
})
hubHistory.get('/:conversationId', async (c) => {
  const owner = hubOwner(c)
  const conversationId = c.req.param('conversationId')
  if (!z.uuid().safeParse(conversationId).success) throw new HTTPException(400, { message: 'Invalid conversation ID.' })
  const turns = await c.get('db').hubTurn.findMany({ where: { ...owner, conversationId, claimToken: null },
    select: fields, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  return c.json({ turns: turns.map(present) })
})
hubHistory.post('/', bodyLimit({ maxSize: 3 * 1024 * 1024 }), async (c) => {
  const input = importedTurn.safeParse(await c.req.json().catch(() => null))
  if (!input.success) throw new HTTPException(400, { message: 'Invalid saved conversation.' })
  const owner = hubOwner(c)
  if (input.data.userId !== owner.userId) throw new HTTPException(403, { message: 'Sign in with the account that saved this chat.' })
  return c.json({ turn: await reserveTurn(c.get('db'), owner, input.data, null) })
})
