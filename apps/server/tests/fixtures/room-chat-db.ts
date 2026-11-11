// In-memory Prisma boundary for the workerd transport test. No real DB credentials.
type Row = { id: string; roomId: string; organizationId: string; authorUserId: string; clientMessageId: string; createdAt: Date; text: string }
const rows: Row[] = []
const executions = new Map<string, Record<string, unknown>>()
export function schedulerExecutions() { return Object.fromEntries(executions) }
let revoked = false
let nextHistory: (() => Promise<void>) | undefined
export function pauseNextHistory(operation: () => Promise<void>) { nextHistory = operation }
export function seed() {
  const time = Math.max(Date.now(), rows.at(-1)?.createdAt.getTime() ?? 0) + 1
  for (let index = 0; index < 205; index++) rows.push({ id: `seed-${index}`, roomId: 'room', organizationId: 'org', authorUserId: 'alice', clientMessageId: crypto.randomUUID(), createdAt: new Date(time + index), text: `missed-${index}` })
}
export function revoke() { revoked = true }
export function createDatabase() {
  const db = {
    schedulerDelivery: { findFirst: async ({ where }: { where: { id: string; leaseToken?: string; schedule?: { event: { organizationId: string; roomId: string; ownerUserId: string } } } }) => {
      if (!['c326b5dc-0fdd-4d70-b838-d155fe1ecacd', 'c326b5dc-0fdd-4d70-b838-d155fe1ecace'].includes(where.id)) return null
      if (where.leaseToken !== undefined && where.leaseToken !== 'valid-lease') return null
      const ownerUserId = where.id.endsWith('e') ? 'outsider' : 'alice'
      if (where.schedule && (where.schedule.event.organizationId !== 'org' || where.schedule.event.roomId !== 'room' || where.schedule.event.ownerUserId !== ownerUserId)) return null
      return { id: where.id, agentId: 'agent-1', schedule: { state: 'started', scheduledAt: new Date('2026-01-01T00:00:00Z'), event: { organizationId: 'org', roomId: 'room', ownerUserId, title: 'Private scheduled event', instruction: 'SCHEDULED_PRIVATE_TASK' } } }
    }, updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      executions.set(where.id, { ...executions.get(where.id), ...data }); return { count: 1 }
    } },
    session: { findFirst: async ({ where }: { where: { userId: string } }) => where.userId !== 'expired' && !(revoked && where.userId === 'bob') ? { id: 'session' } : null },
    roomAgent: {
      findMany: async ({ where }: { where: { organizationId: string; roomId: string } }) => where.organizationId === 'org' && where.roomId === 'room' ? [{ agent: { id: 'agent-1', name: 'Scout', role: 'Research' } }] : [],
      findFirst: async ({ where }: { where: { organizationId: string; roomId: string; agentId: string } }) => where.organizationId === 'org' && where.roomId === 'room' && where.agentId === 'agent-1' ? { agent: { id: 'agent-1', name: 'Scout', role: 'Research', rules: ['Be concise'] } } : null,
    },
    roomMember: {
      findMany: async () => [],
      findFirst: async ({ where }: { where: { member: { userId: string }; organizationId: string } }) => where.member.userId !== 'outsider' && where.organizationId === 'org' ? { organizationMemberId: 'member' } : null,
      update: async () => ({}),
    },
    roomMessage: {
      findFirst: async ({ where, orderBy }: { where: Partial<Row>; orderBy?: unknown }) => {
        const matches = rows.filter((row) => Object.entries(where).every(([key, value]) => value === row[key as keyof Row] || key === 'authorAgentId' || typeof value === 'object'))
        return orderBy ? matches.at(-1) ?? null : matches[0] ?? null
      },
      findMany: async ({ where, orderBy, take }: { where: { roomId: string; organizationId: string; OR?: Array<{ createdAt: { gt?: Date; lt?: Date } }> }; orderBy: Array<{ createdAt?: string }>; take: number }) => {
        const pause = nextHistory
        nextHistory = undefined
        await pause?.()
        const direction = orderBy[0].createdAt === 'asc' ? 1 : -1
        const result = rows.filter((row) => row.roomId === where.roomId && row.organizationId === where.organizationId && (!where.OR || (direction === 1 ? row.createdAt > where.OR[0].createdAt.gt! : row.createdAt < where.OR[0].createdAt.lt!)))
        return result.sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime())).slice(0, take)
      },
      create: async ({ data }: { data: Omit<Row, 'id'> }) => {
        const row = { id: crypto.randomUUID(), ...data, authorAgent: null, authorUser: { name: data.authorUserId }, documents: [] }
        rows.push(row)
        return row
      },
    },
    room: {
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ agentWorkToken: null, agentWorkExpiresAt: null, documents: [] }),
    },
    $transaction: async <T>(fn: (tx: unknown) => T) => fn(db),
    $disconnect: async () => {},
  }
  return db
}
