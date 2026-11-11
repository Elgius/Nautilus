import { bodyLimit } from 'hono/body-limit'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AppEnv } from '../index'
import { plannerService } from './service'
import { parseInput } from '../scheduler/service'
const identity = (c: import('hono').Context<AppEnv>) => ({ organizationId: c.get('organizationId'), roomId: c.req.param('roomId')!, userId: c.get('session').user.id, sessionId: c.get('session').session.id })
const body = (c: import('hono').Context<AppEnv>) => c.req.json().catch(() => { throw new HTTPException(400, { message: 'Provide valid JSON.' }) })
export const plannerRoutes = new Hono<AppEnv>()
plannerRoutes.use('*', bodyLimit({ maxSize: 64 * 1024 }))
plannerRoutes.get('/', async (c) => c.json(await plannerService(c.get('db'), identity(c)).list(c.req.query('after'))))
plannerRoutes.get('/:taskId', async (c) => c.json({ task: await plannerService(c.get('db'), identity(c)).read(c.req.param('taskId')) }))
plannerRoutes.post('/', async (c) => c.json({ task: await plannerService(c.get('db'), identity(c)).create(await body(c)) }, 201))
plannerRoutes.patch('/:taskId', async (c) => c.json({ task: await plannerService(c.get('db'), identity(c)).update(c.req.param('taskId'), await body(c)) }))
plannerRoutes.delete('/:taskId', async (c) => {
  const input = parseInput(z.strictObject({ expectedRevision: z.number().int().positive() }), await body(c))
  return c.json({ task: await plannerService(c.get('db'), identity(c)).update(c.req.param('taskId'), input, true) })
})
