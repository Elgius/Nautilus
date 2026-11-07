import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './index'
import type { Database } from './db'
import type { Bindings } from './env'
import { createStorage } from './storage'
import { guardRoomWrite, type RoomScope } from './documents/room-write-lock'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const attachmentSelect = { id: true, filename: true, mimeType: true, sizeBytes: true, checksum: true,
  uploadedByUserId: true, createdAt: true } as const

type Storage = Pick<ReturnType<typeof createStorage>, 'put' | 'delete' | 'downloadUrl'>
export function createAttachmentService(db: Database, env: Bindings, storage?: Storage) {
  const store = () => storage ?? createStorage(env)
  async function upload(scope: RoomScope, userId: string, file: File) {
    if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new HTTPException(400, { message: 'Choose a non-empty file up to 10 MB.' })
    const filename = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').trim()
    if (!filename || filename.length > 255) throw new HTTPException(400, { message: 'Choose a filename of 1–255 characters.' })
    const bytes = await file.arrayBuffer()
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const id = crypto.randomUUID()
    const objectKey = `organizations/${scope.organizationId}/rooms/${scope.roomId}/attachments/${id}/original`
    const mimeType = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(file.type) && file.type.length <= 255 ? file.type : 'application/octet-stream'
    const storage = store()
    await db.$transaction(async (tx) => {
      await guardRoomWrite(tx, scope)
      await tx.roomAttachment.create({ data: { id, ...scope, filename, mimeType, sizeBytes: bytes.byteLength, checksum, objectKey, uploadedByUserId: userId } })
    })
    try {
      await storage.put(objectKey, bytes, mimeType)
      return await db.$transaction(async (tx) => {
        await guardRoomWrite(tx, scope)
        return tx.roomAttachment.update({ where: { id, ...scope, state: 'PENDING' }, data: { state: 'READY' }, select: attachmentSelect })
      })
    } catch (error) {
      // A lost commit response may mean READY was committed. Never delete a
      // published object; leave uncertain outcomes for reconciliation.
      const record = await db.roomAttachment.findUnique({ where: { id } }).catch(() => null)
      if (record?.state === 'READY') return db.roomAttachment.findUniqueOrThrow({ where: { id }, select: attachmentSelect })
      if (record?.state === 'PENDING') {
        try {
          await storage.delete(objectKey)
          await db.roomAttachment.delete({ where: { id, state: 'PENDING' } })
        } catch { /* Retained PENDING record lets reconciliation retry cleanup. */ }
      }
      throw error
    }
  }
  async function download(scope: RoomScope, id: string) {
    const attachment = await db.roomAttachment.findFirst({ where: { id, ...scope, state: 'READY' } })
    if (!attachment) throw new HTTPException(404, { message: 'Room file not found.' })
    return { url: await store().downloadUrl(attachment.objectKey, attachment.filename), expiresIn: 900 }
  }
  async function remove(scope: RoomScope, id: string) {
    const attachment = await db.$transaction(async (tx) => {
      await guardRoomWrite(tx, scope)
      const record = await tx.roomAttachment.findFirst({ where: { id, ...scope, state: { in: ['READY', 'DELETING'] } } })
      if (!record) throw new HTTPException(404, { message: 'Room file not found.' })
      return tx.roomAttachment.update({ where: { id, ...scope }, data: { state: 'DELETING' } })
    })
    await store().delete(attachment.objectKey)
    await db.roomAttachment.deleteMany({ where: { id, ...scope, state: 'DELETING' } })
  }
  return { upload, download, remove }
}

export const roomAttachments = new Hono<AppEnv>()
const scope = (c: { get: (key: 'organizationId') => string; req: { param: (key: 'roomId') => string } }) => ({ organizationId: c.get('organizationId'), roomId: c.req.param('roomId') })
roomAttachments.get('/', async (c) => c.json({ attachments: await c.get('db').roomAttachment.findMany({
  where: { ...scope(c), state: 'READY' }, select: attachmentSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
}) }))
roomAttachments.post('/', async (c) => {
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new HTTPException(400, { message: 'Choose a file to save to this room.' })
  const attachment = await createAttachmentService(c.get('db'), c.env).upload(scope(c), c.get('session').user.id, file)
  return c.json({ attachment }, 201)
})
roomAttachments.get('/:attachmentId/url', async (c) => c.json(await createAttachmentService(c.get('db'), c.env).download(scope(c), c.req.param('attachmentId'))))
roomAttachments.delete('/:attachmentId', async (c) => {
  await createAttachmentService(c.get('db'), c.env).remove(scope(c), c.req.param('attachmentId'))
  return c.json({ success: true })
})
