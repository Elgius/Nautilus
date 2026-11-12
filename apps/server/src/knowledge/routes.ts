import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AppEnv } from '../index'
import { knowledgeService, scopeInput } from './service'

export const knowledgeRoutes = new Hono<AppEnv>()
knowledgeRoutes.use('*', bodyLimit({ maxSize: 4096 }))
const service = (c: import('hono').Context<AppEnv>) => knowledgeService(c.get('db'), { organizationId: c.get('organizationId'), userId: c.get('session').user.id })
function scope(value?: string) {
  const parsed = scopeInput.safeParse(value)
  if (!parsed.success) throw new HTTPException(400, { message: 'Choose Personal or Organization knowledge.' })
  return parsed.data
}
async function json(c: import('hono').Context<AppEnv>) {
  return c.req.json<unknown>().catch(() => { throw new HTTPException(400, { message: 'Provide valid JSON.' }) })
}
knowledgeRoutes.get('/', async (c) => {
  const cursor = c.req.query('cursor')
  if (cursor && !z.uuid().safeParse(cursor).success) throw new HTTPException(400, { message: 'Invalid source cursor.' })
  return c.json(await service(c).list(scope(c.req.query('scope')), cursor))
})
knowledgeRoutes.post('/sources', async (c) => c.json(await service(c).tag(await json(c)), 201))
knowledgeRoutes.delete('/sources/:sourceId', async (c) => {
  await service(c).remove(scope(c.req.query('scope')), c.req.param('sourceId'))
  return c.json({ removed: true })
})
knowledgeRoutes.get('/sources/:sourceId/history', async (c) => {
  const before = c.req.query('before')
  if (before && (!/^[1-9]\d*$/.test(before) || (!Number.isSafeInteger(Number(before)) || Number(before) > 2_147_483_647))) throw new HTTPException(400, { message: 'Invalid history cursor.' })
  return c.json(await service(c).history(scope(c.req.query('scope')), c.req.param('sourceId'), before ? Number(before) : undefined))
})
knowledgeRoutes.patch('/', async (c) => {
  const parsed = z.strictObject({ scope: scopeInput, enabled: z.boolean() }).safeParse(await json(c))
  if (!parsed.success) throw new HTTPException(400, { message: 'Specify the bucket and whether the agent is enabled.' })
  return c.json({ base: await service(c).configure(parsed.data.scope, parsed.data.enabled) })
})
knowledgeRoutes.post('/refresh', async (c) => {
  const parsed = z.strictObject({ scope: scopeInput }).safeParse(await json(c))
  if (!parsed.success) throw new HTTPException(400, { message: 'Choose a knowledge bucket.' })
  await service(c).refresh(parsed.data.scope)
  return c.json({ queued: true }, 202)
})
