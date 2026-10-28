import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { createMiddleware } from 'hono/factory'
import { bodyLimit } from 'hono/body-limit'
import { agentSelect, parseAgentProfile } from './agents'
import { agentChat } from './agent-chat'
import { rooms } from './rooms'
import { createAuth, type Auth } from './auth'
import { createDatabase, type Database } from './db'
import { isLocalDevelopment, validateBindings, type Bindings } from './env'

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    organizationId: string
    db: Database
    auth: Auth
    session: Auth['$Infer']['Session']
  }
}

const app = new Hono<AppEnv>()
app.get('/', (c) => c.json({ name: 'Nautilus API', status: 'ok' }))
app.get('/health', (c) => c.json({ status: 'ok' }))

app.use('/api/*', cors({
  origin: (origin, c) => origin === c.env.WEB_ORIGIN ? origin : undefined,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Invitation-Id'],
}))

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  validateBindings(c.env)
  const db = createDatabase(c.env.DATABASE_URL)
  c.set('db', db)
  c.set('auth', createAuth(c.env, db))
  try {
    await next()
  } finally {
    // Worker sockets belong to the request that uses them.
    await db.$disconnect()
  }
})

app.on(['GET', 'POST'], '/api/auth/*', (c) => c.get('auth').handler(c.req.raw))

const authenticated = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.get('auth').api.getSession({ headers: c.req.raw.headers })
  if (!session) throw new HTTPException(401, { message: 'Sign in required.' })
  c.set('session', session)
  await next()
})

const platformAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = await c.get('db').user.findUnique({
    where: { id: c.get('session').user.id }, select: { platformRole: true },
  })
  if (user?.platformRole !== 'admin') throw new HTTPException(403, { message: 'Platform administrator access required.' })
  await next()
})

app.get('/api/me', authenticated, async (c) => {
  const { user, session } = c.get('session')
  const memberships = await c.get('db').member.findMany({
    where: { userId: user.id },
    select: { organizationId: true, role: true, organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const activeOrganization = memberships.find((member) => member.organizationId === session.activeOrganizationId)?.organization ?? null
  return c.json({ user, memberships, activeOrganization, needsOrganizationSelection: memberships.length > 1 && !activeOrganization })
})

// All organisation-scoped business routes must check live membership.
// Platform administrator status alone never grants access to tenant data.
app.get('/api/organizations/:organizationId', authenticated, async (c) => {
  const membership = await c.get('db').member.findUnique({
    where: { organizationId_userId: {
      organizationId: c.req.param('organizationId'), userId: c.get('session').user.id,
    } },
    select: { role: true, organization: { select: { id: true, name: true, slug: true, logo: true } } },
  })
  if (!membership) throw new HTTPException(404, { message: 'Organisation not found.' })
  return c.json(membership)
})

const agentPath = '/api/organizations/:organizationId/agents'
app.use(`${agentPath}/*`, bodyLimit({ maxSize: 3 * 1024 * 1024 }))
app.use(agentPath, bodyLimit({ maxSize: 3 * 1024 * 1024 }))

const organizationMember = createMiddleware<AppEnv>(async (c, next) => {
  const organizationId = c.req.param('organizationId')!
  const membership = await c.get('db').member.findUnique({
    where: { organizationId_userId: { organizationId, userId: c.get('session').user.id } },
    select: { id: true },
  })
  if (!membership) throw new HTTPException(404, { message: 'Organisation not found.' })
  if (c.req.method !== 'GET' && c.req.header('Origin') !== c.env.WEB_ORIGIN) {
    throw new HTTPException(403, { message: 'Invalid request origin.' })
  }
  c.set('organizationId', organizationId)
  await next()
})

app.get(agentPath, authenticated, organizationMember, async (c) => {
  const agents = await c.get('db').agent.findMany({
    where: { organizationId: c.get('organizationId') },
    select: agentSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return c.json({ agents })
})

app.post(agentPath, authenticated, organizationMember, async (c) => {
  const input: unknown = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'Enter a valid agent profile.' })
  })
  const data = parseAgentProfile(input)
  const agent = await c.get('db').agent.create({
    data: { ...data, organizationId: c.get('organizationId') }, select: agentSelect,
  })
  return c.json({ agent }, 201)
})

app.patch(`${agentPath}/:agentId`, authenticated, organizationMember, async (c) => {
  const where = { id: c.req.param('agentId'), organizationId: c.get('organizationId') }
  const input: unknown = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'Enter a valid agent profile.' })
  })
  const data = parseAgentProfile(input)
  // The tenant predicate stays in the mutation, not only in a preceding lookup.
  const agent = await c.get('db').agent.update({ where, data, select: agentSelect })
  return c.json({ agent })
})

app.use(`${agentPath}/:agentId/chat`, authenticated, organizationMember)
app.route(agentPath, agentChat)

const roomPath = '/api/organizations/:organizationId/rooms'
app.use(`${roomPath}/*`, authenticated, organizationMember)
app.route(roomPath, rooms)

app.get('/api/admin/organizations', authenticated, platformAdmin, async (c) => {
  const organizations = await c.get('db').organization.findMany({
    select: { id: true, name: true, slug: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take: 100,
  })
  return c.json({ organizations })
})

app.get('/api/admin/email-outbox', authenticated, platformAdmin, async (c) => {
  if (c.env.EMAIL_DELIVERY_MODE !== 'outbox' || !isLocalDevelopment(c.env)) throw new HTTPException(404)
  const messages = await c.get('db').emailMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  return c.json({ messages })
})

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  if ('code' in error && error.code === 'P2002') {
    return c.json({ error: c.req.path.includes('/agents')
      ? 'Choose a name that isn’t already used by another agent.'
      : 'This record changed. Reload and try again.' }, 409)
  }
  if ('code' in error && error.code === 'P2025') return c.json({ error: 'Record not found.' }, 404)
  if ('code' in error && error.code === 'P2003') return c.json({ error: 'A related record is unavailable.' }, 400)
  // Database/provider exception messages can contain secrets.
  console.error('API request failed', { path: c.req.path, errorType: error.name })
  return c.json({ error: 'Internal server error.' }, 500)
})

export default app
