import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'
import { rooms } from '../src/rooms'

function historyApp(count: number) {
  const versions = Array.from({ length: count }, (_, index) => ({
    id: `version-${index + 1}`, organizationId: 'org', roomId: 'room', documentId: 'doc', versionNumber: index + 1,
  }))
  // Exercise the route with an in-memory database boundary; no remote database is needed.
  const db = {
    room: { findUnique: async () => ({ id: 'room' }) },
    document: { findFirst: async () => ({ id: 'doc' }) },
    documentVersion: { findMany: async ({ where, take }: {
      where: { organizationId: string; roomId: string; documentId: string; versionNumber?: { lt: number } }; take: number
    }) => versions.filter((version) => version.organizationId === where.organizationId && version.roomId === where.roomId &&
      version.documentId === where.documentId && (!where.versionNumber || version.versionNumber < where.versionNumber.lt))
      .sort((a, b) => b.versionNumber - a.versionNumber).slice(0, take) },
  } as unknown as Database
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('db', db)
    c.set('organizationId', 'org')
    await next()
  })
  app.route('/', rooms)
  return app
}

test('version history reaches the oldest version across multiple pages without gaps or duplicates', async () => {
  const app = historyApp(205)
  const numbers: number[] = []
  let cursor: string | null = null
  const sizes: number[] = []
  do {
    const response = await app.request(`/room/documents/doc/versions${cursor ? `?before=${cursor}` : ''}`)
    expect(response.status).toBe(200)
    const page = await response.json() as { versions: { versionNumber: number }[]; nextCursor: string | null }
    sizes.push(page.versions.length)
    numbers.push(...page.versions.map((version) => version.versionNumber))
    cursor = page.nextCursor
    expect(sizes.length).toBeLessThanOrEqual(3)
  } while (cursor)
  expect(sizes).toEqual([100, 100, 5])
  expect(numbers).toEqual(Array.from({ length: 205 }, (_, index) => 205 - index))
})

test('version history has no next page for empty or exactly full histories', async () => {
  for (const count of [0, 100]) {
    const response = await historyApp(count).request('/room/documents/doc/versions')
    const page = await response.json()
    expect(page.versions).toHaveLength(count)
    expect(page.nextCursor).toBeNull()
  }
})

test('version pagination rejects malformed cursors and keeps document scope', async () => {
  const app = historyApp(205)
  for (const cursor of ['', '0', '-1', '1.5', 'nope', '2147483648', '9007199254740992']) {
    expect((await app.request(`/room/documents/doc/versions?before=${cursor}`)).status).toBe(400)
  }
  const response = await app.request('/room/documents/another-doc/versions?before=150')
  expect(await response.json()).toEqual({ versions: [], nextCursor: null })
})
