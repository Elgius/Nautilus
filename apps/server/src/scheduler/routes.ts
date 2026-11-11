import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { AppEnv } from '../index'
import { parseInput, schedulerService, scheduleTime } from './service'

export const schedulerRoutes = new Hono<AppEnv>()
schedulerRoutes.use('*', bodyLimit({ maxSize: 64 * 1024 }))
const service = (c: import('hono').Context<AppEnv>) => schedulerService(c.get('db'), {
  organizationId: c.get('organizationId'), roomId: c.req.param('roomId')!, userId: c.get('session').user.id, sessionId: c.get('session').session.id,
})
const body = (request: { json: () => Promise<unknown> }) => request.json().catch(() => { throw new HTTPException(400, { message: 'Provide valid JSON.' }) })
schedulerRoutes.post('/', async (c) => c.json(await service(c).create(await body(c.req)), 201))
schedulerRoutes.get('/', async (c) => c.json(await service(c).list(c.req.query('after'))))
schedulerRoutes.patch('/:scheduleId', async (c) => {
  const input = parseInput(z.strictObject({ scheduledAt: scheduleTime }), await body(c.req))
  return c.json(await service(c).change(c.req.param('scheduleId'), input.scheduledAt))
})
schedulerRoutes.delete('/:scheduleId', async (c) => c.json(await service(c).change(c.req.param('scheduleId'))))

schedulerRoutes.post('/:scheduleId/deliveries/:deliveryId/cancel', async (c) => {
  const identity = { organizationId: c.get('organizationId'), roomId: c.req.param('roomId')!, userId: c.get('session').user.id, sessionId: c.get('session').session.id }
  if (!c.env.ROOM_CHAT) throw new HTTPException(503, { message: 'Agent runtime unavailable.' })
  const coordinator = c.env.ROOM_CHAT.get(c.env.ROOM_CHAT.idFromName(JSON.stringify([identity.organizationId, identity.roomId])))
  const response = await coordinator.fetch(new Request('https://room.internal/scheduler-cancel', { method: 'POST', body: JSON.stringify({ identity, scheduleId: c.req.param('scheduleId'), deliveryId: c.req.param('deliveryId') }) }))
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } })
})
