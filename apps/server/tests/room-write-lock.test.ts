import { expect, test } from 'bun:test'
import type { Database } from '../src/db'
import { acquireRoomWork, guardRoomWrite, releaseRoomWork } from '../src/documents/room-write-lock'

const scope = { organizationId: 'org', roomId: 'room' }
function harness() {
  let token: string | null = null, expiresAt: Date | null = null
  const db = { room: { updateMany: async ({ where, data }: {
    where: { id: string; organizationId: string; agentWorkToken?: string; agentWorkExpiresAt?: { gt: Date }; OR?: unknown[] }
    data: { agentWorkToken?: string | null; agentWorkExpiresAt?: Date | null }
  }) => {
    if (where.id !== scope.roomId || where.organizationId !== scope.organizationId) return { count: 0 }
    if (where.OR && token && expiresAt && expiresAt > new Date()) return { count: 0 }
    if (where.agentWorkToken && token !== where.agentWorkToken) return { count: 0 }
    if (where.agentWorkExpiresAt && (!expiresAt || expiresAt <= where.agentWorkExpiresAt.gt)) return { count: 0 }
    if ('agentWorkToken' in data) { token = data.agentWorkToken!; expiresAt = data.agentWorkExpiresAt! }
    return { count: 1 }
  } } } as unknown as Database
  return { db, expire: () => { expiresAt = new Date(0) } }
}

test('a room lease blocks human writes while allowing only its owning moderator', async () => {
  const { db } = harness()
  await guardRoomWrite(db, scope)
  expect(await acquireRoomWork(db, scope, 'run-a')).toBe(true)
  await expect(guardRoomWrite(db, scope)).rejects.toMatchObject({ status: 423 })
  await guardRoomWrite(db, scope, 'run-a')
  await expect(guardRoomWrite(db, scope, 'run-b')).rejects.toMatchObject({ status: 423 })
  expect(await acquireRoomWork(db, scope, 'run-b')).toBe(false)
  await releaseRoomWork(db, scope, 'run-b')
  await expect(guardRoomWrite(db, scope)).rejects.toMatchObject({ status: 423 })
  await releaseRoomWork(db, scope, 'run-a')
  await guardRoomWrite(db, scope)
})

test('expired runs cannot commit or release a replacement run’s lease', async () => {
  const h = harness()
  await acquireRoomWork(h.db, scope, 'old')
  h.expire()
  await expect(guardRoomWrite(h.db, scope, 'old')).rejects.toMatchObject({ status: 423 })
  expect(await acquireRoomWork(h.db, scope, 'new')).toBe(true)
  await releaseRoomWork(h.db, scope, 'old')
  await expect(guardRoomWrite(h.db, scope)).rejects.toMatchObject({ status: 423 })
  await guardRoomWrite(h.db, scope, 'new')
  expect(await acquireRoomWork(h.db, { ...scope, organizationId: 'other-org' }, 'forged')).toBe(false)
})
