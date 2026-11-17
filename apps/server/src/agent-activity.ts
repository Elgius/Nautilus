import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { AppEnv } from './index'
import type { Database } from './db'
import type { ChatIdentity } from './room-chat-service'
import type { PrivateAgentJob, AgentWorkActivity } from '../../../shared/room-chat'
import type { ActivityStatus } from '../../../shared/agent-activity'
import type { Prisma } from './generated/prisma/client'

export function activityStatus(job: PrivateAgentJob): ActivityStatus {
  return job.status === 'failed' && /^Cancelled\b/.test(job.error ?? '') ? 'cancelled' : job.status
}

// Monotonic snapshots make replay and delayed outbox delivery safe. Names survive
// agent removal; owner and room deletion cascade the private archive.
export async function archiveAgentRun(db: Database, identity: ChatIdentity, job: PrivateAgentJob) {
  const status = activityStatus(job)
  const activities = JSON.stringify(job.status === 'running' ? job.activities ?? [] : [])
  const commits = JSON.stringify(job.commits ?? []), taskCommits = JSON.stringify(job.taskCommits ?? [])
  await db.$executeRaw`INSERT INTO "agentActivityRun"
    ("organizationId", "roomId", "userId", id, "agentId", "agentName", title, status, source, revision,
     instruction, reply, error, "errorCode", issues, activities, commits, "taskCommits", "createdAt", "updatedAt", "startedAt", "finishedAt")
    SELECT ${identity.organizationId}, ${identity.roomId}, ${identity.userId}, ${job.id}, ${job.agentId}, ${job.agentName},
      ${Array.from(job.instruction).slice(0, 200).join('')}, ${status}, COALESCE(${job.source ?? null}, CASE WHEN EXISTS (
        SELECT 1 FROM "schedulerDelivery" d JOIN "schedulerSchedule" s ON s.id = d."scheduleId"
        JOIN "schedulerEvent" e ON e.id = s."eventId"
        WHERE d.id = ${job.id} AND e."organizationId" = ${identity.organizationId} AND e."roomId" = ${identity.roomId} AND e."ownerUserId" = ${identity.userId}
      ) THEN 'scheduled' ELSE 'manual' END), ${job.revision}, ${job.instruction}, ${job.reply}, ${job.error ?? null}, ${job.errorCode ?? null}, ${JSON.stringify(job.issues ?? [])}::jsonb,
      ${activities}::jsonb, ${commits}::jsonb, ${taskCommits}::jsonb, ${new Date(job.createdAt)}, ${new Date(job.updatedAt)},
      ${job.startedAt ? new Date(job.startedAt) : null}, ${job.finishedAt ? new Date(job.finishedAt) : null}
    WHERE EXISTS (SELECT 1 FROM room WHERE "organizationId" = ${identity.organizationId} AND id = ${identity.roomId})
      AND EXISTS (SELECT 1 FROM "user" WHERE id = ${identity.userId})
    ON CONFLICT ("organizationId", "roomId", "userId", id) DO UPDATE SET
      status = EXCLUDED.status, revision = EXCLUDED.revision, reply = EXCLUDED.reply, error = EXCLUDED.error, "errorCode" = EXCLUDED."errorCode", issues = EXCLUDED.issues,
      activities = EXCLUDED.activities, commits = EXCLUDED.commits, "taskCommits" = EXCLUDED."taskCommits",
      "updatedAt" = EXCLUDED."updatedAt", "startedAt" = EXCLUDED."startedAt", "finishedAt" = EXCLUDED."finishedAt"
    WHERE "agentActivityRun".revision < EXCLUDED.revision`
}

const identifier = z.string().min(1).max(100)
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: identifier, roomId: identifier })
export const activityQuery = z.strictObject({
  roomId: identifier.optional(), agentId: identifier.optional(),
  status: z.enum(['queued', 'running', 'complete', 'failed', 'cancelled']).optional(),
  from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), cursor: z.string().max(1000).optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, 'Choose an end date after the start date.')
export function activityScope(organizationId: string, userId: string): Prisma.AgentActivityRunWhereInput {
  return { organizationId, userId, room: { members: { some: { organizationId, member: { organizationId, userId } } } } }
}
const summarySelect = {
  id: true, roomId: true, room: { select: { name: true } }, agentId: true, agentName: true, title: true, status: true, source: true,
  createdAt: true, updatedAt: true, startedAt: true, finishedAt: true, activities: true, commits: true, taskCommits: true,
} as const
const summary = (run: Prisma.AgentActivityRunGetPayload<{ select: typeof summarySelect }>) => {
  const { room, commits, taskCommits, ...fields } = run
  return { ...fields, roomName: room.name, activities: run.activities as unknown as AgentWorkActivity[],
    documentCount: Array.isArray(commits) ? commits.length : 0, taskCount: Array.isArray(taskCommits) ? taskCommits.length : 0 }
}
export const agentActivity = new Hono<AppEnv>()
agentActivity.get('/', async (c) => {
  const parsed = activityQuery.safeParse(c.req.query())
  if (!parsed.success) throw new HTTPException(400, { message: 'Invalid activity filters.' })
  const q = parsed.data, db = c.get('db'), organizationId = c.get('organizationId'), userId = c.get('session').user.id
  let cursor: z.infer<typeof cursorSchema> | undefined
  if (q.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(q.cursor)) } catch { throw new HTTPException(400, { message: 'Invalid activity cursor.' }) }
  }
  const scope = activityScope(organizationId, userId)
  const where: Prisma.AgentActivityRunWhereInput = { ...scope,
    ...(q.roomId ? { roomId: q.roomId } : {}), ...(q.agentId ? { agentId: q.agentId } : {}), ...(q.status ? { status: q.status } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    ...(cursor ? { OR: [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      { createdAt: new Date(cursor.createdAt), id: cursor.id, roomId: { lt: cursor.roomId } },
    ] } : {}),
  }
  const [rows, active, rooms, agents] = await Promise.all([
    db.agentActivityRun.findMany({ where, select: summarySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }, { roomId: 'desc' }], take: 31 }),
    db.agentActivityRun.findMany({ where: { ...scope, status: { in: ['queued', 'running'] } }, select: summarySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }, { roomId: 'desc' }], take: 20 }),
    db.room.findMany({ where: { organizationId, members: { some: { member: { organizationId, userId } } } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.agentActivityRun.findMany({ where: scope, distinct: ['agentId'], select: { agentId: true, agentName: true }, orderBy: { createdAt: 'desc' } }),
  ])
  const page = rows.slice(0, 30), last = page.at(-1)
  return c.json({ runs: page.map(summary), active: active.map(summary), rooms,
    agents: agents.map((a) => ({ id: a.agentId, name: a.agentName })),
    nextCursor: rows.length > 30 && last ? JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id, roomId: last.roomId }) : null })
})

// Bounded import of retained private history; browser-supplied owner IDs are never accepted.
agentActivity.post('/sync', async (c) => {
  const after = c.req.query('after')
  if (after !== undefined && (!after || after.length > 100)) throw new HTTPException(400, { message: 'Invalid history cursor.' })
  const session = c.get('session'), organizationId = c.get('organizationId')
  const rooms = await c.get('db').room.findMany({ where: { organizationId, members: { some: { member: { organizationId, userId: session.user.id } } }, ...(after ? { id: { gt: after } } : {}) },
    select: { id: true }, orderBy: { id: 'asc' }, take: 6 })
  if (c.env.ROOM_CHAT) {
    await Promise.all(rooms.slice(0, 5).map(async ({ id: roomId }) => {
      const coordinator = c.env.ROOM_CHAT!.get(c.env.ROOM_CHAT!.idFromName(JSON.stringify([organizationId, roomId])))
      const response = await coordinator.fetch(new Request('https://room.internal/activity-history', { method: 'POST', body: JSON.stringify({ organizationId, roomId, userId: session.user.id, sessionId: session.session.id }) }))
      if (!response.ok) throw new HTTPException(503, { message: 'Recent room history could not be imported. Try again.' })
    }))
  }
  return c.json({ nextCursor: rooms.length > 5 ? rooms[4].id : null })
})

agentActivity.get('/:roomId/:runId', async (c) => {
  const db = c.get('db'), scope = activityScope(c.get('organizationId'), c.get('session').user.id)
  const roomId = c.req.param('roomId'), run = await db.agentActivityRun.findFirst({
    where: { ...scope, roomId, id: c.req.param('runId') }, select: { instruction: true, reply: true, error: true, errorCode: true, issues: true, commits: true, taskCommits: true },
  })
  if (!run) throw new HTTPException(404, { message: 'Activity not found.' })
  const commits = run.commits as unknown as NonNullable<PrivateAgentJob['commits']>, tasks = run.taskCommits as unknown as NonNullable<PrivateAgentJob['taskCommits']>
  const [documents, taskRows] = await Promise.all([
    db.document.findMany({ where: { organizationId: c.get('organizationId'), roomId, id: { in: commits.map((d) => d.documentId) } }, select: { id: true, title: true } }),
    db.plannerTask.findMany({ where: { organizationId: c.get('organizationId'), roomId, id: { in: tasks.map((t) => t.taskId) } }, select: { id: true, title: true, deletedAt: true } }),
  ])
  return c.json({ instruction: run.instruction, reply: run.reply, error: run.error, errorCode: run.errorCode, issues: run.issues,
    documents: commits.map((d) => ({ ...d, title: documents.find((r) => r.id === d.documentId)?.title ?? 'Deleted document', available: documents.some((r) => r.id === d.documentId) })),
    tasks: tasks.map((t) => ({ ...t, title: taskRows.find((r) => r.id === t.taskId)?.title ?? 'Deleted task', available: taskRows.some((r) => r.id === t.taskId && !r.deletedAt) })),
  })
})
