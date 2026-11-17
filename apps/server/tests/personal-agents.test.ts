import { expect, test } from 'bun:test'
import { registerPersonalRoomAgent } from '../src/personal-agents'
import type { Database } from '../src/db'

function harness(expired = false) {
  const registrations = new Set<string>(), lookups: unknown[] = []
  const db = {
    session: { findFirst: async () => expired ? null : ({ id: 'session' }) },
    roomMember: { findFirst: async () => ({ organizationMemberId: 'member' }) },
    agent: { findFirst: async ({ where }: { where: { id: string; organizationId: string; createdByUserId: string } }) => {
      lookups.push(where)
      return where.id === 'mine' && where.organizationId === 'org' && where.createdByUserId === 'alice'
        ? { id: 'mine', name: 'Scout', role: 'Research', rules: [] } : null
    } },
    roomAgent: { createMany: async ({ data, skipDuplicates }: { data: { roomId: string; agentId: string }; skipDuplicates: boolean }) => {
      expect(skipDuplicates).toBe(true)
      registrations.add(`${data.roomId}:${data.agentId}`)
    } },
    $transaction: async <T>(action: (tx: unknown) => Promise<T>) => action(db),
  }
  return { db: db as unknown as Database, registrations, lookups }
}
const identity = { organizationId: 'org', roomId: 'room', userId: 'alice', sessionId: 'session' }

test('first use registers a personally owned agent, and repeated use is idempotent', async () => {
  const h = harness()
  expect(await registerPersonalRoomAgent(h.db, identity, 'mine')).toMatchObject({ id: 'mine' })
  await registerPersonalRoomAgent(h.db, identity, 'mine')
  expect(h.registrations.size).toBe(1)
  expect(h.lookups[0]).toEqual({ id: 'mine', organizationId: 'org', createdByUserId: 'alice' })
})

test('room membership does not grant use of another user’s agent or an unowned agent', async () => {
  const h = harness()
  for (const [userId, agentId] of [['bob', 'mine'], ['alice', 'unowned'], ['alice', 'other-user']]) {
    expect(await registerPersonalRoomAgent(h.db, { ...identity, userId }, agentId)).toBeNull()
  }
  expect(h.registrations.size).toBe(0)
})

test('an expired room session cannot register an agent', async () => {
  const h = harness(true)
  expect(await registerPersonalRoomAgent(h.db, identity, 'mine')).toBeNull()
  expect(h.lookups).toEqual([])
})
