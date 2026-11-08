import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './index'

// Metadata only. Authentication and live membership are enforced at the mount.
export const documentLibrary = new Hono<AppEnv>()
documentLibrary.get('/', async (c) => {
  const cursor = c.req.query('cursor')
  const query = (c.req.query('q') || '').trim()
  if ((cursor && cursor.length > 100) || query.length > 200) throw new HTTPException(400, { message: 'Invalid document search.' })
  const documents = await c.get('db').document.findMany({
    where: {
      organizationId: c.get('organizationId'),
      ...(cursor ? { id: { gt: cursor } } : {}),
      ...(query ? { OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { room: { name: { contains: query, mode: 'insensitive' } } },
      ] } : {}),
    },
    orderBy: { id: 'asc' }, take: 51,
    select: { id: true, title: true, kind: true, status: true, updatedAt: true, room: { select: { id: true, name: true } } },
  })
  const page = documents.slice(0, 50)
  return c.json({ documents: page, nextCursor: documents.length > 50 ? page.at(-1)!.id : null })
})
