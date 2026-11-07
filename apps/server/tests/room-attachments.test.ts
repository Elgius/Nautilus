import { expect, test } from 'bun:test'
import type { Database } from '../src/db'
import type { Bindings } from '../src/env'
import { createAttachmentService, MAX_ATTACHMENT_BYTES } from '../src/room-attachments'

const scope = { organizationId: 'org', roomId: 'room' }
function harness(options: { failPut?: boolean; failDelete?: boolean; failPublish?: boolean; locked?: boolean } = {}) {
  let record: Record<string, unknown> | null = null
  let stored: ArrayBuffer | null = null
  const calls: string[] = []
  const table = {
    create: async ({ data }: { data: Record<string, unknown> }) => { record = { ...data, state: 'PENDING' }; return record },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      if (options.failPublish && data.state === 'READY') throw new Error('DB failed')
      Object.assign(record!, data); return record
    },
    findUnique: async () => record,
    findUniqueOrThrow: async () => record,
    findFirst: async ({ where }: { where: { organizationId: string; roomId: string; state?: unknown } }) => {
      if (where.organizationId !== record?.organizationId || where.roomId !== record?.roomId) return null
      if (where.state === 'READY' && record?.state !== 'READY') return null
      return record
    },
    delete: async () => { record = null },
    deleteMany: async () => { record = null },
  }
  const tx = { roomAttachment: table, room: { updateMany: async () => ({ count: options.locked ? 0 : 1 }) } }
  const db = { ...tx, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) } as unknown as Database
  const storage = {
    put: async (_key: string, body: string | ArrayBuffer) => {
      calls.push('put'); if (options.failPut) throw new Error('Storage failed'); stored = body as ArrayBuffer
    },
    delete: async () => { calls.push('delete'); if (options.failDelete) throw new Error('Delete failed'); stored = null },
    downloadUrl: async (_key: string, filename?: string) => { calls.push('sign'); return `signed:${filename}` },
  }
  return { service: createAttachmentService(db, {} as Bindings, storage), calls, record: () => record, stored: () => stored }
}
const file = () => new File([new Uint8Array([0, 255, 13, 10, 127])], 'original.bin', { type: 'application/octet-stream' })

test('explicit upload preserves binary bytes and publishes metadata only after storage succeeds', async () => {
  const h = harness(); expect(h.calls).toEqual([])
  const result = await h.service.upload(scope, 'user', file())
  expect(result.filename).toBe('original.bin')
  expect(result.sizeBytes).toBe(5)
  expect(result.checksum).toHaveLength(64)
  expect(h.record()?.state).toBe('READY')
  expect(new Uint8Array(h.stored()!)).toEqual(new Uint8Array(await file().arrayBuffer()))
  expect(await h.service.download(scope, result.id)).toEqual({ url: 'signed:original.bin', expiresIn: 900 })
  await expect(h.service.download({ ...scope, organizationId: 'other' }, result.id)).rejects.toMatchObject({ status: 404 })
  await h.service.remove(scope, result.id)
  expect(h.stored()).toBeNull(); expect(h.record()).toBeNull()
})

test('invalid and locked uploads never touch storage', async () => {
  const h = harness()
  await expect(h.service.upload(scope, 'user', new File([], 'empty'))).rejects.toMatchObject({ status: 400 })
  await expect(h.service.upload(scope, 'user', new File([new ArrayBuffer(MAX_ATTACHMENT_BYTES + 1)], 'large'))).rejects.toMatchObject({ status: 400 })
  expect(h.calls).toEqual([])
  const locked = harness({ locked: true })
  await expect(locked.service.upload(scope, 'user', file())).rejects.toMatchObject({ status: 423 })
  expect(locked.calls).toEqual([])
})

test('failed uploads and failed publication clean up their object and pending record', async () => {
  for (const options of [{ failPut: true }, { failPublish: true }]) {
    const h = harness(options)
    await expect(h.service.upload(scope, 'user', file())).rejects.toThrow()
    expect(h.calls).toEqual(['put', 'delete'])
    expect(h.record()).toBeNull(); expect(h.stored()).toBeNull()
  }
})

test('cleanup failures retain pending keys and deletion failures retain retryable tombstones', async () => {
  const pending = harness({ failPut: true, failDelete: true })
  await expect(pending.service.upload(scope, 'user', file())).rejects.toThrow()
  expect(pending.record()?.state).toBe('PENDING')
  const deleting = harness({ failDelete: true })
  const result = await deleting.service.upload(scope, 'user', file())
  await expect(deleting.service.remove(scope, result.id)).rejects.toThrow()
  expect(deleting.record()?.state).toBe('DELETING')
  await expect(deleting.service.download(scope, result.id)).rejects.toMatchObject({ status: 404 })
})
