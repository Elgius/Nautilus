import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { rooms } from '../src/rooms'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'

test('room bootstrap returns scoped public history only for live room members', async () => {
  for (const [live, member] of [[true, true], [true, false], [false, true]]) {
    let historyReads = 0
    const db = {
      room: { findUnique: async () => ({ id: 'room' }), findUniqueOrThrow: async () => ({ id: 'room', members: [], documents: [] }) },
      session: { findFirst: async () => live ? { id: 'session' } : null },
      roomMember: { findFirst: async () => member ? { organizationMemberId: 'member' } : null },
      roomMessage: { findMany: async (query: unknown) => {
        historyReads++
        expect(query).toMatchObject({ where: { organizationId: 'org', roomId: 'room', authorAgentId: null, authorUserId: { not: null } }, take: 101 })
        return [{ id: 'public-message', text: 'Hello', createdAt: new Date() }]
      } },
    } as unknown as Database
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('db', db); c.set('organizationId', 'org')
      c.set('session', { user: { id: 'alice' }, session: { id: 'session' } } as AppEnv['Variables']['session'])
      await next()
    })
    app.route('/', rooms)
    const response = await app.request('/room', {}, {})
    expect(response.status).toBe(200)
    const data = await response.json() as { messages: { id: string }[]; nextCursor: string | null }
    expect(data.messages.map((message) => message.id)).toEqual(live && member ? ['public-message'] : [])
    expect(historyReads).toBe(live && member ? 1 : 0)
    expect(data.nextCursor).toBeNull()
  }
})
