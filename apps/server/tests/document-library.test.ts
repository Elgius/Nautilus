import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { AppEnv } from '../src/index'
import type { Database } from '../src/db'
import { documentLibrary } from '../src/document-library'

type LibraryPage = { documents: { id: string }[]; nextCursor: string | null };

function libraryApp(count: number) {
  const documents = Array.from({ length: count }, (_, index) => ({
    id: `doc-${String(index).padStart(4, '0')}`, organizationId: 'org',
    title: `Plan ${index}`, room: { id: 'room', name: 'Design' },
  }))
  const calls: Record<string, unknown>[] = []
  const db = { document: { findMany: async (args: {
    where: { organizationId: string; id?: { gt: string }; OR?: { title?: { contains: string } }[] }; take: number
  }) => {
    calls.push(args)
    return documents.filter((doc) => doc.organizationId === args.where.organizationId &&
      (!args.where.id || doc.id > args.where.id.gt) &&
      (!args.where.OR || `${doc.title} ${doc.room.name}`.toLowerCase().includes(args.where.OR[0].title!.contains.toLowerCase())))
      .slice(0, args.take)
  } } } as unknown as Database
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => { c.set('db', db); c.set('organizationId', c.req.header('X-Test-Organization') || 'org'); await next() })
  app.route('/', documentLibrary)
  return { app, calls }
}

test('library pagination is bounded and visits every document without duplicates', async () => {
  const { app, calls } = libraryApp(123)
  const ids: string[] = [], sizes: number[] = []
  let cursor: string | null = null
  do {
    const response = await app.request(`/${cursor ? `?cursor=${cursor}` : ''}`)
    expect(response.status).toBe(200)
    const page = await response.json() as { documents: { id: string }[]; nextCursor: string | null }
    sizes.push(page.documents.length); ids.push(...page.documents.map((doc) => doc.id)); cursor = page.nextCursor
    expect(sizes.length).toBeLessThanOrEqual(3)
  } while (cursor)
  expect(sizes).toEqual([50, 50, 23])
  expect(new Set(ids).size).toBe(123)
  expect(calls[0].select).toEqual({ id: true, title: true, kind: true, status: true, updatedAt: true, room: { select: { id: true, name: true } } })
})

test('library scope cannot be overridden through query parameters and search spans all pages', async () => {
  const { app } = libraryApp(123)
  expect(((await (await app.request('/?q=Plan%20122')).json()) as LibraryPage).documents).toHaveLength(1)
  expect(((await (await app.request('/?q=design')).json()) as LibraryPage).documents).toHaveLength(50)
  expect(((await (await app.request('/?organizationId=org', { headers: { 'X-Test-Organization': 'other' } })).json()) as LibraryPage).documents).toHaveLength(0)
  expect((await app.request(`/?cursor=${'x'.repeat(101)}`)).status).toBe(400)
  expect((await app.request(`/?q=${'x'.repeat(201)}`)).status).toBe(400)
})

test('empty and exactly full document pages have no continuation', async () => {
  for (const count of [0, 50]) {
    const { app } = libraryApp(count)
    const page = await (await app.request('/')).json() as LibraryPage
    expect(page.documents).toHaveLength(count)
    expect(page.nextCursor).toBeNull()
  }
})
