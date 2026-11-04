import { expect, test } from 'bun:test'
import { canChat, chatHistory, parseSend, saveChatMessage, type ChatIdentity } from '../src/room-chat-service'
import type { Database } from '../src/db'

const identity: ChatIdentity = { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'session' }
const clientMessageId = 'f380b82a-35dc-44eb-a206-57b69308ec86'

test('chat requires a live session and membership in the requested room and organization', async () => {
  const queries: unknown[] = []
  for (const [session, member, allowed] of [[{}, {}, true], [null, {}, false], [{}, null, false]] as const) {
    const db = {
      session: { findFirst: async (query: unknown) => { queries.push(query); return session } },
      roomMember: { findFirst: async (query: unknown) => { queries.push(query); return member } },
    } as unknown as Database
    expect(Boolean(await canChat(db, identity))).toBe(allowed)
  }
  expect(queries[0]).toMatchObject({ where: { id: 'session', userId: 'alice', expiresAt: { gt: expect.any(Date) } } })
  expect(queries[1]).toMatchObject({ where: { roomId: 'room', organizationId: 'org', member: { userId: 'alice', organizationId: 'org' } } })
})

test('message validation rejects empty, oversized, and malformed sends and ignores forged author fields', () => {
  expect(parseSend({ text: ' hello ', clientMessageId, authorAgentId: 'bot', authorUserId: 'mallory' })).toEqual({ text: 'hello', clientMessageId })
  for (const input of [{ text: '', clientMessageId }, { text: ' '.repeat(10), clientMessageId }, { text: 'a'.repeat(20001), clientMessageId }, { text: 'hello', clientMessageId: 'bad' }]) expect(() => parseSend(input)).toThrow()
})

test('retries return one persisted user message and preserve the authenticated author', async () => {
  let saved: Record<string, unknown> | null = null
  const writes: Record<string, unknown>[] = []
  const clock = new Date(Date.now() + 1000)
  const db = {
    roomMessage: {
      findFirst: async ({ where }: { where: { clientMessageId?: string } }) => where.clientMessageId ? saved : { createdAt: clock },
      create: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); saved = { id: 'saved', ...data }; return saved },
    },
    room: { update: async () => ({}) },
    $transaction: async (fn: (db: unknown) => unknown) => fn(db),
  } as unknown as Database
  const message = await saveChatMessage(db, identity, parseSend({ text: 'hello', clientMessageId }))
  expect(await saveChatMessage(db, identity, parseSend({ text: 'retry', clientMessageId }))).toEqual(message)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ roomId: 'room', organizationId: 'org', authorUserId: 'alice', text: 'hello', createdAt: new Date(clock.getTime() + 1) })
  expect(writes[0]).not.toHaveProperty('authorAgentId')
})

test('history filters agents, isolates room cursors, and paginates replay without dropping a boundary message', async () => {
  const queries: unknown[] = []
  const rows = Array.from({ length: 101 }, (_, index) => ({ id: String(index), createdAt: new Date(index), text: String(index) }))
  const db = { roomMessage: {
    findFirst: async (query: unknown) => { queries.push(query); return { id: 'anchor', createdAt: new Date(0) } },
    findMany: async (query: unknown) => { queries.push(query); return rows },
  } } as unknown as Database
  const page = await chatHistory(db, identity, 'anchor', 'after')
  expect(page.messages).toHaveLength(100)
  expect(page.nextCursor).toBe('99')
  expect(page.messages[99].id).toBe('99')
  expect(queries[0]).toMatchObject({ where: { id: 'anchor', roomId: 'room', organizationId: 'org', authorAgentId: null } })
  expect(queries[1]).toMatchObject({ where: { roomId: 'room', organizationId: 'org', authorAgentId: null, OR: [{ createdAt: { gt: new Date(0) } }, { createdAt: new Date(0), id: { gt: 'anchor' } }] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101 })
  const initial = await chatHistory(db, identity)
  expect(initial.messages[0].id).toBe('99')
  expect(initial.nextCursor).toBe('99')
  const missing = { roomMessage: { findFirst: async () => null } } as unknown as Database
  await expect(chatHistory(missing, identity, 'other-room-message')).rejects.toThrow('Invalid history cursor')
})
