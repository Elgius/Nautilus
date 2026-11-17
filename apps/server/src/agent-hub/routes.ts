import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AppEnv } from '../index'
import { canChat } from '../room-chat-service'
import { agentAppearanceSelect } from '../agents'
import { officeConfigured } from '../office-service'
import { storageConfigured } from '../storage'
import { runInput } from './contracts'

export const agentHub = new Hono<AppEnv>()
agentHub.use('*', bodyLimit({ maxSize: 256 * 1024 }))
agentHub.get('/rooms', async (c) => c.json({ rooms: await c.get('db').room.findMany({
  where: { organizationId: c.get('organizationId'), members: { some: { member: { organizationId: c.get('organizationId'), userId: c.get('session').user.id } } } },
  select: { id: true, name: true, agents: { orderBy: { position: 'asc' }, select: { agent: { select: { ...agentAppearanceSelect, role: true } } } } }, orderBy: { name: 'asc' },
}) }))
agentHub.get('/capabilities', (c) => c.json({ documents: storageConfigured(c.env) && officeConfigured(c.env), knowledge: true, kanban: true, calendar: true, scheduling: true,
  execution: !!c.env.ROOM_CHAT, localAttachments: false }))
agentHub.all('/rooms/:roomId/*', async (c) => {
  const roomId = z.uuid().safeParse(c.req.param('roomId'))
  if (!roomId.success) throw new HTTPException(400, { message: 'Choose a valid room.' })
  const identity = { organizationId: c.get('organizationId'), roomId: roomId.data, userId: c.get('session').user.id,
    sessionId: c.get('session').session.id, name: c.get('session').user.name }
  if (!await canChat(c.get('db'), identity)) throw new HTTPException(403, { message: 'Join this room before using its agents.' })
  if (!c.env.ROOM_CHAT) throw new HTTPException(503, { message: 'Agent execution is not configured.' })
  const tail = c.req.path.split(`/rooms/${roomId.data}/`)[1]
  let action: string, input: unknown = {}
  const json = async () => c.req.json().catch(() => { throw new HTTPException(400, { message: 'Provide valid JSON.' }) })
  if (tail === 'history' && c.req.method === 'GET') action = 'history'
  else if (tail === 'runs' && c.req.method === 'POST') {
    action = 'invoke'; const parsed = runInput.safeParse(await json())
    if (!parsed.success) throw new HTTPException(400, { message: 'Provide a valid instruction, agent and request ID.' })
    input = parsed.data
  } else {
    const match = /^runs\/([\da-f-]+)\/(cancel|confirm)$/.exec(tail ?? '')
    if (!match || !z.uuid().safeParse(match[1]).success || c.req.method !== 'POST') throw new HTTPException(404)
    action = match[2]; input = { jobId: match[1] }
    if (action === 'confirm') {
      const parsed = z.strictObject({ confirmationId: z.uuid(), approved: z.boolean() }).safeParse(await json())
      if (!parsed.success) throw new HTTPException(400, { message: 'Choose approve or decline for this confirmation.' })
      input = { ...input as object, ...parsed.data }
    }
  }
  const coordinator = c.env.ROOM_CHAT.get(c.env.ROOM_CHAT.idFromName(JSON.stringify([identity.organizationId, identity.roomId])))
  const response = await coordinator.fetch(new Request('https://room.internal/agent-hub', { method: 'POST', body: JSON.stringify({ identity, action, input }) }))
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
})
