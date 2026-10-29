import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './index'
import type { Database } from './db'
import { createStorage, storageConfigured } from './storage'
import { object, parseRoom, text } from './room-validation'
import { MAX_OFFICE_BYTES, validateOfficeContent } from './office-content'
import { officeConfigured, officeRequest } from './office-service'
import { createDocumentService, versionSelect } from './documents/document-service'

export const rooms = new Hono<AppEnv>()
rooms.use('*', bodyLimit({ maxSize: MAX_OFFICE_BYTES + 1024 * 1024 }))

const roomInclude = (userId: string) => ({
  agents: { orderBy: { position: 'asc' as const }, select: { agent: { select: { id: true, name: true } } } },
  members: { select: { organizationMemberId: true, role: true, lastReadAt: true,
    member: { select: { user: { select: { id: true, name: true } } } } } },
  stars: { where: { userId }, select: { userId: true } },
  documents: { orderBy: { createdAt: 'asc' as const }, select: {
    id: true, title: true, kind: true, category: true, status: true, currentVersionId: true, updatedAt: true,
  } },
})
const messageInclude = {
  authorUser: { select: { name: true } }, authorAgent: { select: { name: true } },
  documents: { select: { documentId: true, documentVersionId: true, document: { select: { title: true, kind: true } } } },
} as const

async function body(request: { json: () => Promise<unknown> }) {
  return object(await request.json().catch(() => { throw new HTTPException(400, { message: 'Provide valid JSON.' }) }))
}
async function checkAgents(db: Database, organizationId: string, agentIds: string[]) {
  if (await db.agent.count({ where: { organizationId, id: { in: agentIds } } }) !== agentIds.length) {
    throw new HTTPException(400, { message: 'Choose agents from this organisation.' })
  }
}
async function messagesPage(db: Database, organizationId: string, roomId: string, before?: string) {
  const cursor = before ? await db.roomMessage.findFirst({ where: { organizationId, roomId, id: before }, select: { id: true, createdAt: true } }) : null
  if (before && !cursor) throw new HTTPException(400, { message: 'Invalid message cursor.' })
  const rows = await db.roomMessage.findMany({
    where: { organizationId, roomId, ...(cursor ? { OR: [
      { createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ] } : {}) },
    include: messageInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
  })
  const page = rows.slice(0, 50)
  return { messages: page.reverse(), nextCursor: rows.length > 50 ? page[0].id : null }
}

rooms.get('/', async (c) => c.json({ rooms: await c.get('db').room.findMany({
  where: { organizationId: c.get('organizationId') },
  include: roomInclude(c.get('session').user.id), orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
}) }))

rooms.post('/', async (c) => {
  const { agentIds, ...data } = parseRoom(await body(c.req))
  const organizationId = c.get('organizationId'), userId = c.get('session').user.id, db = c.get('db')
  await checkAgents(db, organizationId, agentIds)
  const member = await db.member.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId } } })
  const room = await db.room.create({ data: { ...data, organizationId, createdByUserId: userId,
    members: { create: { organizationMemberId: member.id, role: 'OWNER' } },
    agents: { create: agentIds.map((agentId, position) => ({ agentId, addedByUserId: userId, position })) },
  }, include: roomInclude(userId) })
  return c.json({ room }, 201)
})

rooms.use('/:roomId/*', async (c, next) => {
  if (!await c.get('db').room.findUnique({ where: { id: c.req.param('roomId'), organizationId: c.get('organizationId') }, select: { id: true } })) throw new HTTPException(404, { message: 'Room not found.' })
  await next()
})

rooms.get('/:roomId', async (c) => {
  const organizationId = c.get('organizationId'), roomId = c.req.param('roomId'), db = c.get('db')
  const [room, page] = await Promise.all([
    db.room.findUniqueOrThrow({ where: { id: roomId, organizationId }, include: roomInclude(c.get('session').user.id) }),
    messagesPage(db, organizationId, roomId),
  ])
  return c.json({ room, ...page, storageConfigured: storageConfigured(c.env), officeConfigured: officeConfigured(c.env) })
})

rooms.patch('/:roomId', async (c) => {
  const { agentIds, ...data } = parseRoom(await body(c.req))
  const organizationId = c.get('organizationId'), roomId = c.req.param('roomId'), db = c.get('db')
  await checkAgents(db, organizationId, agentIds)
  const room = await db.$transaction(async (tx) => {
    await tx.roomAgent.deleteMany({ where: { organizationId, roomId } })
    return tx.room.update({ where: { id: roomId, organizationId }, data: { ...data, lastActivityAt: new Date(),
      agents: { create: agentIds.map((agentId, position) => ({ agentId, addedByUserId: c.get('session').user.id, position })) },
    }, include: roomInclude(c.get('session').user.id) })
  })
  return c.json({ room })
})

rooms.post('/:roomId/star', async (c) => {
  const input = await body(c.req)
  if (typeof input.starred !== 'boolean') throw new HTTPException(400, { message: 'Specify whether this room is starred.' })
  const organizationId = c.get('organizationId'), roomId = c.req.param('roomId'), userId = c.get('session').user.id
  if (input.starred) await c.get('db').roomStar.upsert({ where: { roomId_userId: { roomId, userId } },
    create: { roomId, organizationId, userId }, update: {} })
  else await c.get('db').roomStar.deleteMany({ where: { organizationId, roomId, userId } })
  return c.json({ starred: input.starred })
})

rooms.post('/:roomId/members', async (c) => {
  const input = await body(c.req), organizationId = c.get('organizationId'), roomId = c.req.param('roomId')
  const userId = input.userId === undefined ? c.get('session').user.id : text(input.userId, 'User ID', 100)
  const member = await c.get('db').member.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { id: true } })
  if (!member) throw new HTTPException(400, { message: 'Choose a member of this organisation.' })
  await c.get('db').roomMember.upsert({ where: { roomId_organizationMemberId: { roomId, organizationMemberId: member.id } },
    create: { organizationId, roomId, organizationMemberId: member.id }, update: {} })
  return c.json({ success: true })
})

rooms.post('/:roomId/read', async (c) => {
  const organizationId = c.get('organizationId'), roomId = c.req.param('roomId')
  const member = await c.get('db').member.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: c.get('session').user.id } } })
  await c.get('db').roomMember.upsert({ where: { roomId_organizationMemberId: { roomId, organizationMemberId: member.id } },
    create: { organizationId, roomId, organizationMemberId: member.id, lastReadAt: new Date() }, update: { lastReadAt: new Date() } })
  return c.json({ success: true })
})

rooms.get('/:roomId/messages', async (c) => c.json(await messagesPage(c.get('db'), c.get('organizationId'), c.req.param('roomId'), c.req.query('before'))))
rooms.post('/:roomId/messages', async (c) => {
  const input = await body(c.req), organizationId = c.get('organizationId'), roomId = c.req.param('roomId')
  const messageText = text(input.text, 'Message', 20_000)
  const attachments = input.documents === undefined ? [] : input.documents
  if (!Array.isArray(attachments) || attachments.length > 20) throw new HTTPException(400, { message: 'Attach up to 20 room documents.' })
  const documents: { documentId: string; documentVersionId: string | null }[] = []
  for (const item of attachments) {
    const attachment = object(item), documentId = text(attachment.documentId, 'Document ID', 100)
    const documentVersionId = attachment.documentVersionId == null ? null : text(attachment.documentVersionId, 'Version ID', 100)
    if (!await c.get('db').document.findFirst({ where: { organizationId, roomId, id: documentId }, select: { id: true } }) ||
      (documentVersionId && !await c.get('db').documentVersion.findFirst({ where: { organizationId, roomId, documentId, id: documentVersionId }, select: { id: true } }))) {
      throw new HTTPException(400, { message: 'Choose documents and versions from this room.' })
    }
    if (documents.some((item) => item.documentId === documentId)) throw new HTTPException(400, { message: 'Attach each document once.' })
    documents.push({ documentId, documentVersionId })
  }
  const message = await c.get('db').$transaction(async (tx) => {
    const result = await tx.roomMessage.create({ data: { organizationId, roomId, authorUserId: c.get('session').user.id, text: messageText,
      documents: { create: documents },
    }, include: messageInclude })
    await tx.room.update({ where: { id: roomId, organizationId }, data: { lastActivityAt: new Date() } })
    return result
  })
  return c.json({ message }, 201)
})

rooms.post('/:roomId/documents', async (c) => {
  const input = await body(c.req)
  const kind = (['DOCUMENT', 'SPREADSHEET'] as const).find((kind) => kind === input.kind)
  if (!kind) throw new HTTPException(400, { message: 'Choose a document or spreadsheet.' })
  const document = await c.get('db').$transaction(async (tx) => {
    const document = await tx.document.create({ data: { organizationId: c.get('organizationId'), roomId: c.req.param('roomId'),
      title: text(input.title, 'Document title', 150), category: text(input.category ?? 'Notes', 'Category', 70), kind } })
    await tx.room.update({ where: { id: c.req.param('roomId'), organizationId: c.get('organizationId') }, data: { lastActivityAt: new Date() } })
    return document
  })
  return c.json({ document }, 201)
})

rooms.use('/:roomId/documents/:documentId/*', async (c, next) => {
  if (!await c.get('db').document.findFirst({ where: { id: c.req.param('documentId'), roomId: c.req.param('roomId'), organizationId: c.get('organizationId') }, select: { id: true } })) {
    throw new HTTPException(404, { message: 'Document not found.' })
  }
  await next()
})

rooms.patch('/:roomId/documents/:documentId', async (c) => {
  const input = await body(c.req)
  const status = (['DRAFT', 'IN_REVIEW', 'READY'] as const).find((status) => status === input.status)
  if (!status) throw new HTTPException(400, { message: 'Choose a valid document status.' })
  return c.json({ document: await c.get('db').document.update({ where: { id: c.req.param('documentId'), roomId: c.req.param('roomId'), organizationId: c.get('organizationId') },
    data: { title: text(input.title, 'Document title', 150), category: text(input.category ?? 'Notes', 'Category', 70), status } }) })
})

rooms.get('/:roomId/documents/:documentId/versions', async (c) => {
  const before = c.req.query('before')
  if (before !== undefined && (!/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before)) || Number(before) > 2_147_483_647)) {
    throw new HTTPException(400, { message: 'Invalid version cursor.' })
  }
  const rows = await c.get('db').documentVersion.findMany({
    where: { organizationId: c.get('organizationId'), roomId: c.req.param('roomId'), documentId: c.req.param('documentId'),
      ...(before === undefined ? {} : { versionNumber: { lt: Number(before) } }),
    },
    select: versionSelect, orderBy: { versionNumber: 'desc' }, take: 101,
  })
  const versions = rows.slice(0, 100)
  return c.json({ versions, nextCursor: rows.length > 100 ? String(versions[versions.length - 1].versionNumber) : null })
})

rooms.get('/:roomId/documents/:documentId/content', async (c) => {
  const { content, currentVersionId } = await createDocumentService(c.get('db'), c.env).readDocument({
    organizationId: c.get('organizationId'), roomId: c.req.param('roomId'), documentId: c.req.param('documentId'),
  })
  return c.json({ content, currentVersionId })
})

// Room/document middleware and the parent organization middleware enforce access
// before any file is passed to the private conversion service.
rooms.post('/:roomId/documents/:documentId/import', async (c) => {
  const document = await c.get('db').document.findFirstOrThrow({ where: { id: c.req.param('documentId'), roomId: c.req.param('roomId'), organizationId: c.get('organizationId') } })
  const form = await c.req.formData(), file = form.get('file')
  if (!(file instanceof File) || !file.size || file.size > MAX_OFFICE_BYTES) throw new HTTPException(400, { message: 'Choose a non-empty file up to 10 MB.' })
  const upload = new FormData()
  upload.set('file', file)
  const response = await officeRequest(c.env, `/import/${document.kind}`, upload)
  const result = await response.json() as { content: unknown }
  return c.json({ content: validateOfficeContent(document.kind, result.content) })
})

rooms.post('/:roomId/documents/:documentId/export', async (c) => {
  const document = await c.get('db').document.findFirstOrThrow({ where: { id: c.req.param('documentId'), roomId: c.req.param('roomId'), organizationId: c.get('organizationId') } })
  const content = validateOfficeContent(document.kind, await body(c.req))
  const response = await officeRequest(c.env, '/export', JSON.stringify(content), true)
  return new Response(response.body, { headers: {
    'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="document.${document.kind === 'DOCUMENT' ? 'docx' : 'xlsx'}"`,
    'Cache-Control': 'no-store',
  } })
})

rooms.get('/:roomId/documents/:documentId/versions/:versionId/url', async (c) => {
  const version = await c.get('db').documentVersion.findFirstOrThrow({ where: { id: c.req.param('versionId'), documentId: c.req.param('documentId'),
    roomId: c.req.param('roomId'), organizationId: c.get('organizationId') }, select: { objectKey: true } })
  return c.json({ url: await createStorage(c.env).downloadUrl(version.objectKey), expiresIn: 900 })
})

rooms.post('/:roomId/documents/:documentId/versions', async (c) => {
  const input = await body(c.req)
  const version = await createDocumentService(c.get('db'), c.env).saveVersion({
    organizationId: c.get('organizationId'), roomId: c.req.param('roomId'), documentId: c.req.param('documentId'),
  }, {
    expectedVersionId: input.expectedVersionId as string | null, content: input.content,
    changeSummary: input.changeSummary as string | null | undefined,
  }, { userId: c.get('session').user.id })
  return c.json({ version }, 201)
})
