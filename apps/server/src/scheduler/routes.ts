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
