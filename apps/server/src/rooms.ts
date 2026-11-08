import { schedulerRoutes } from './scheduler/routes'
import { Hono } from 'hono'
import { roomAttachments } from './room-attachments'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './index'
import type { Database } from './db'
import { createStorage, storageConfigured } from './storage'
import { object, parseRoom, text } from './room-validation'
import { MAX_OFFICE_BYTES, validateOfficeContent } from './office-content'
import { officeConfigured, officeRequest } from './office-service'
import { createDocumentService, versionSelect } from './documents/document-service'
import { canChat } from './room-chat-service'
import { agentAppearanceSelect } from './agents'
import { guardRoomWrite } from './documents/room-write-lock'

export const rooms = new Hono<AppEnv>()
rooms.use('*', bodyLimit({ maxSize: MAX_OFFICE_BYTES + 1024 * 1024 }))
const privateRoomFields = { agentWorkToken: true, agentWorkExpiresAt: true } as const

const roomInclude = (userId: string) => ({
  agents: { orderBy: { position: 'asc' as const }, select: { agent: { select: agentAppearanceSelect } } },
  members: { select: { organizationMemberId: true, role: true, lastReadAt: true,
    member: { select: { user: { select: { id: true, name: true } } } } } },
  stars: { where: { userId }, select: { userId: true } },
  documents: { orderBy: { createdAt: 'asc' as const }, select: {
    id: true, title: true, kind: true, category: true, status: true, currentVersionId: true, updatedAt: true,
  } },
})

async function body(request: { json: () => Promise<unknown> }) {
  return object(await request.json().catch(() => { throw new HTTPException(400, { message: 'Provide valid JSON.' }) }))
}
async function checkAgents(db: Database, organizationId: string, agentIds: string[]) {
  if (await db.agent.count({ where: { organizationId, id: { in: agentIds } } }) !== agentIds.length) {
    throw new HTTPException(400, { message: 'Choose agents from this organisation.' })
  }
}

rooms.get('/', async (c) => c.json({ rooms: await c.get('db').room.findMany({
  omit: privateRoomFields,
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
  }, include: roomInclude(userId), omit: privateRoomFields })
  return c.json({ room }, 201)
})

rooms.use('/:roomId/*', async (c, next) => {
  if (!await c.get('db').room.findUnique({ where: { id: c.req.param('roomId'), organizationId: c.get('organizationId') }, select: { id: true } })) throw new HTTPException(404, { message: 'Room not found.' })
  await next()
})

rooms.route('/:roomId/attachments', roomAttachments)
rooms.route('/:roomId/schedules', schedulerRoutes)

// Server-authored identity only; the client cannot submit history or another user ID.
rooms.post('/:roomId/suggestions', async (c) => {
  const identity = { organizationId: c.get('organizationId'), roomId: c.req.param('roomId'),
    userId: c.get('session').user.id, sessionId: c.get('session').session.id }
  if (!await canChat(c.get('db'), identity)) throw new HTTPException(403, { message: 'Join this room to use chat suggestions.' })
  if (!c.env.ROOM_CHAT) return c.json({ suggestions: [] })
  const coordinator = c.env.ROOM_CHAT.get(c.env.ROOM_CHAT.idFromName(JSON.stringify([identity.organizationId, identity.roomId])))
  const response = await coordinator.fetch(new Request('https://room.internal/suggestions', { method: 'POST', body: JSON.stringify(identity) }))
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
})

rooms.post('/:roomId/socket-ticket', async (c) => {
  if (!c.env.ROOM_CHAT) throw new HTTPException(503, { message: 'Room chat is not configured.' })
  const identity = { organizationId: c.get('organizationId'), roomId: c.req.param('roomId'),
    userId: c.get('session').user.id, sessionId: c.get('session').session.id, name: c.get('session').user.name }
  if (!await canChat(c.get('db'), identity)) throw new HTTPException(403, { message: 'Join this room to use chat.' })
  const coordinator = c.env.ROOM_CHAT.get(c.env.ROOM_CHAT.idFromName(JSON.stringify([identity.organizationId, identity.roomId])))
  const response = await coordinator.fetch(new Request('https://room.internal/ticket', { method: 'POST', body: JSON.stringify(identity) }))
  const { ticket } = await response.json() as { ticket: string }
  const url = new URL(`/api/room-sockets/${encodeURIComponent(identity.organizationId)}/${encodeURIComponent(identity.roomId)}`, c.env.ROOM_SOCKET_ORIGIN ?? c.env.BETTER_AUTH_URL)
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  url.searchParams.set('ticket', ticket)
  return c.json({ url: url.toString() })
})

rooms.get('/:roomId', async (c) => {
  const organizationId = c.get('organizationId'), roomId = c.req.param('roomId'), db = c.get('db')
  const room = await db.room.findUniqueOrThrow({ where: { id: roomId, organizationId }, include: roomInclude(c.get('session').user.id), omit: privateRoomFields })
  return c.json({ room, messages: [], nextCursor: null, storageConfigured: storageConfigured(c.env), officeConfigured: officeConfigured(c.env) })
})

// Shared activity contains names and targets only, never private instructions/replies.
rooms.get('/:roomId/work', async (c) => {
  const organizationId = c.get('organizationId'), roomId = c.req.param('roomId')
  const room = await c.get('db').room.findUniqueOrThrow({ where: { id: roomId, organizationId },
    select: { agentWorkToken: true, agentWorkExpiresAt: true, documents: { select: { id: true, currentVersionId: true } } } })
  const locked = !!room.agentWorkToken && !!room.agentWorkExpiresAt && room.agentWorkExpiresAt > new Date()
  let activity = { queued: 0, activities: [] as import('../../../shared/room-chat').AgentWorkActivity[] }
  if (c.env.ROOM_CHAT) {
    const coordinator = c.env.ROOM_CHAT.get(c.env.ROOM_CHAT.idFromName(JSON.stringify([organizationId, roomId])))
    const response = await coordinator.fetch(new Request('https://room.internal/work'))
    if (!response.ok) throw new HTTPException(503, { message: 'Room activity is unavailable.' })
    activity = await response.json<typeof activity>()
  }
  return c.json({ ...activity, activities: locked ? activity.activities : [], locked,
    expiresAt: locked ? room.agentWorkExpiresAt!.toISOString() : null,
    versions: Object.fromEntries(room.documents.map((document) => [document.id, document.currentVersionId])) }, 200, { 'Cache-Control': 'no-store' })
})

rooms.patch('/:roomId', async (c) => {
  const { agentIds, ...data } = parseRoom(await body(c.req))
  const organizationId = c.get('organizationId'), roomId = c.req.param('roomId'), db = c.get('db')
  await checkAgents(db, organizationId, agentIds)
  const room = await db.$transaction(async (tx) => {
    await guardRoomWrite(tx, { organizationId, roomId })
    await tx.roomAgent.deleteMany({ where: { organizationId, roomId } })
    return tx.room.update({ where: { id: roomId, organizationId }, data: { ...data, lastActivityAt: new Date(),
      agents: { create: agentIds.map((agentId, position) => ({ agentId, addedByUserId: c.get('session').user.id, position })) },
    }, include: roomInclude(c.get('session').user.id), omit: privateRoomFields })
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

rooms.post('/:roomId/documents', async (c) => {
  const input = await body(c.req)
  const kind = (['DOCUMENT', 'SPREADSHEET'] as const).find((kind) => kind === input.kind)
  if (!kind) throw new HTTPException(400, { message: 'Choose a document or spreadsheet.' })
  const document = await c.get('db').$transaction(async (tx) => {
    await guardRoomWrite(tx, { organizationId: c.get('organizationId'), roomId: c.req.param('roomId') })
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
  const document = await c.get('db').$transaction(async (tx) => {
    await guardRoomWrite(tx, { organizationId: c.get('organizationId'), roomId: c.req.param('roomId') })
    return tx.document.update({ where: { id: c.req.param('documentId'), roomId: c.req.param('roomId'), organizationId: c.get('organizationId') },
      data: { title: text(input.title, 'Document title', 150), category: text(input.category ?? 'Notes', 'Category', 70), status } })
  })
  return c.json({ document })
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
  await c.get('db').$transaction((tx) => guardRoomWrite(tx, { organizationId: c.get('organizationId'), roomId: c.req.param('roomId') }))
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
