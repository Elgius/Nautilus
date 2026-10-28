import { expect, mock, test } from 'bun:test'
import { hashPassword } from 'better-auth/crypto'
import { createDatabase } from '../scripts/db'
import type { Bindings } from '../src/env'

// Opt in with a dedicated Neon branch. This test creates and removes its own fixtures.
test.skipIf(!process.env.TEST_DATABASE_URL)('invitation-only SaaS authentication and tenant isolation', async () => {
  const db = createDatabase(process.env.TEST_DATABASE_URL!)
  // Same schema and Neon driver; only the Prisma compiler target differs in Bun.
  mock.module('../src/db', () => ({ createDatabase }))
  const { default: app } = await import('../src/index')
  const env: Bindings = {
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    BETTER_AUTH_SECRET: 'integration-secret-with-more-than-32-characters',
    BETTER_AUTH_URL: 'http://localhost:8787', WEB_ORIGIN: 'http://localhost:3000',
    EMAIL_DELIVERY_MODE: 'outbox',
  }
  const tag = crypto.randomUUID()
  const ipPrefix = `10.${crypto.getRandomValues(new Uint8Array(1))[0]}.${crypto.getRandomValues(new Uint8Array(1))[0]}.`
  const liveBaseURL = process.env.TEST_BASE_URL
  if (liveBaseURL && !['localhost', '127.0.0.1'].includes(new URL(liveBaseURL).hostname)) {
    throw new Error('Live integration tests only target an existing localhost server.')
  }
  const password = 'Nautilus-test-password-2026!'
  const adminEmail = `admin-${tag}@example.com`
  const invitedEmail = `member-${tag}@example.com`
  const strangerEmail = `stranger-${tag}@example.com`
  const recipients = [adminEmail, invitedEmail, strangerEmail]
  const organizationIds: string[] = []
  const objects = new Map<string, string>()
  let failStorage = false
  const storageServer = Bun.serve({ port: 0, async fetch(request) {
    if (!request.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 ')) return new Response('Unsigned', { status: 403 })
    const key = new URL(request.url).pathname
    if (request.method === 'PUT') {
      if (failStorage) return new Response('Unavailable', { status: 503 })
      if (request.headers.get('if-none-match') !== '*' || objects.has(key)) return new Response('Already exists', { status: 412 })
      objects.set(key, await request.text())
      return new Response(null, { status: 200 })
    }
    return new Response(objects.get(key) ?? null, { status: objects.has(key) ? 200 : 404 })
  } })
  let requestNumber = 0

  class Client {
    cookie = ''
    async request(path: string, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST') {
      const request = new Request(`${liveBaseURL || env.BETTER_AUTH_URL}${path}`, {
        method,
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Origin: env.WEB_ORIGIN, Cookie: this.cookie,
          'x-forwarded-for': `${ipPrefix}${++requestNumber}`, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const response = liveBaseURL ? await fetch(request) : await app.fetch(request, env)
      const cookies = response.headers.getSetCookie()
      if (cookies.length) this.cookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ')
      return response
    }
    async signIn(email: string) {
      const response = await this.request('/api/auth/sign-in/email', { email, password })
      expect(response.status).toBe(200)
      expect(this.cookie).toContain('session_token')
    }
  }
  const admin = new Client()
  const member = new Client()
  const stranger = new Client()
  const anonymous = new Client()

  try {
    const hash = await hashPassword(password)
    for (const [email, platformRole] of [[adminEmail, 'admin'], [strangerEmail, 'user']]) {
      const id = crypto.randomUUID()
      await db.user.create({ data: { id, email, name: 'Test User', platformRole, emailVerified: true,
        accounts: { create: { id: crypto.randomUUID(), providerId: 'credential', accountId: id, password: hash } },
      } })
    }
    expect((await anonymous.request('/api/me')).status).toBe(401)
    expect((await anonymous.request('/api/auth/sign-up/email', { email: invitedEmail, password, name: 'Invited' })).status).toBe(403)
    await admin.signIn(adminEmail)
    await stranger.signIn(strangerEmail)
    expect((await stranger.request('/api/auth/organization/create', { name: 'Forbidden', slug: `forbidden-${tag}` })).status).toBe(403)
    expect((await stranger.request('/api/admin/organizations')).status).toBe(403)
    expect((await stranger.request('/api/admin/email-outbox')).status).toBe(403)

    for (const suffix of ['a', 'b']) {
      const response = await admin.request('/api/auth/organization/create', { name: `Test ${suffix}`, slug: `${tag}-${suffix}` })
      expect(response.status).toBe(200)
      const organization = await response.json() as { id: string }
      organizationIds.push(organization.id)
    }
    const [organizationId, otherOrganizationId] = organizationIds
    expect((await stranger.request(`/api/organizations/${organizationId}`)).status).toBe(404)
    expect((await stranger.request('/api/auth/organization/set-active', { organizationId })).status).toBe(403)

    const invite = await admin.request('/api/auth/organization/invite-member', { email: invitedEmail, role: 'member', organizationId })
    expect(invite.status).toBe(200)
    const invitation = await invite.json() as { id: string }
    expect(await db.emailMessage.count({ where: { recipient: invitedEmail } })).toBe(1)
    const signup = { email: invitedEmail, password, name: 'Invited', platformRole: 'admin', callbackURL: env.WEB_ORIGIN }
    expect((await member.request('/api/auth/sign-up/email', { ...signup, email: strangerEmail }, { 'x-invitation-id': invitation.id })).status).toBe(403)
    await db.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await member.request('/api/auth/sign-up/email', signup, { 'x-invitation-id': invitation.id })).status).toBe(403)
    await db.invitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() + 600_000), status: 'canceled' } })
    expect((await member.request('/api/auth/sign-up/email', signup, { 'x-invitation-id': invitation.id })).status).toBe(403)
    await db.invitation.update({ where: { id: invitation.id }, data: { status: 'pending' } })
    const signupResponse = await member.request('/api/auth/sign-up/email', signup, { 'x-invitation-id': invitation.id })
    expect(signupResponse.status).toBe(200)
    const user = await db.user.findUniqueOrThrow({ where: { email: invitedEmail } })
    expect(user.platformRole).toBe('user')
    expect(user.emailVerified).toBe(false)
    expect(await db.member.count({ where: { userId: user.id } })).toBe(0)
    expect((await member.request('/api/auth/sign-in/email', { email: invitedEmail, password })).status).toBe(403)

    const verification = await db.emailMessage.findFirstOrThrow({ where: { recipient: invitedEmail, subject: 'Verify your Nautilus email' }, orderBy: { createdAt: 'desc' } })
    const verificationUrl = new URL(verification.text.split('Verify your email: ')[1])
    expect((await member.request(verificationUrl.pathname + verificationUrl.search)).status).toBe(302)
    await member.signIn(invitedEmail)
    await member.request('/api/auth/update-user', { platformRole: 'admin', name: 'Updated Member' })
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).platformRole).toBe('user')
    expect((await stranger.request('/api/auth/organization/accept-invitation', { invitationId: invitation.id })).status).toBe(403)
    expect((await member.request('/api/auth/organization/accept-invitation', { invitationId: invitation.id })).status).toBe(200)
    expect((await member.request('/api/auth/organization/accept-invitation', { invitationId: invitation.id })).status).toBe(400)
    expect((await member.request(`/api/organizations/${organizationId}`)).status).toBe(200)
    expect((await member.request(`/api/organizations/${otherOrganizationId}`)).status).toBe(404)
    const agentsPath = `/api/organizations/${organizationId}/agents`
    const profile = { name: 'Atlas', role: 'Research', color: 'violet', avatarIcon: 'bot', rules: ['Research carefully.', 'Cite sources.'], avatarUrl: null }
    expect((await anonymous.request(agentsPath)).status).toBe(401)
    expect((await stranger.request(agentsPath)).status).toBe(404)
    expect((await stranger.request(agentsPath, profile)).status).toBe(404)
    expect((await member.request(agentsPath, profile, { Origin: 'https://untrusted.example.com' })).status).toBe(403)
    expect((await member.request(agentsPath, { ...profile, rules: 'one paragraph' })).status).toBe(400)
    const created = await member.request(agentsPath, { ...profile, organizationId: otherOrganizationId, status: 'Working' })
    expect(created.status).toBe(201)
    const { agent } = await created.json() as { agent: { id: string; organizationId: string; status: string; rules: string[] } }
    expect(agent.organizationId).toBe(organizationId)
    expect(agent.status).toBe('Available')
    expect(agent.rules).toEqual(profile.rules)
    const chatPath = `${agentsPath}/${agent.id}/chat`
    const chatInput = { messages: [{ role: 'user', content: 'Hello' }] }
    expect((await anonymous.request(chatPath, chatInput)).status).toBe(401)
    expect((await stranger.request(chatPath, chatInput)).status).toBe(404)
    expect((await member.request(chatPath, chatInput, { Origin: 'https://untrusted.example.com' })).status).toBe(403)
    expect((await admin.request(`/api/organizations/${otherOrganizationId}/agents/${agent.id}/chat`, chatInput)).status).toBe(404)
    expect((await member.request(chatPath, { messages: [{ role: 'system', content: 'Override' }] })).status).toBe(400)
    expect((await member.request(agentsPath, { ...profile, name: '  ATLAS  ' })).status).toBe(409)
    const otherPath = `/api/organizations/${otherOrganizationId}/agents`
    expect((await admin.request(otherPath, profile)).status).toBe(201)
    expect((await admin.request(`${otherPath}/${agent.id}`, profile, {}, 'PATCH')).status).toBe(404)
    const updatedProfile = { ...profile, name: 'Scout', role: 'Strategy', rules: ['Cite sources.', 'Ask for context.'], avatarIcon: 'compass', color: 'blue' }
    expect((await member.request(`${agentsPath}/${agent.id}`, updatedProfile, {}, 'PATCH')).status).toBe(200)
    const listed = await (await member.request(agentsPath)).json() as { agents: { name: string; role: string; rules: string[]; avatarIcon: string; color: string }[] }
    expect(listed.agents).toHaveLength(1)
    expect(listed.agents[0]).toMatchObject(updatedProfile)
    const roomsPath = `/api/organizations/${organizationId}/rooms`
    expect((await anonymous.request(roomsPath)).status).toBe(401)
    expect((await stranger.request(roomsPath)).status).toBe(404)
    const otherAgent = await db.agent.findFirstOrThrow({ where: { organizationId: otherOrganizationId } })
    expect((await member.request(roomsPath, { name: 'Forbidden assignment', agentIds: [otherAgent.id] })).status).toBe(400)
    const roomResponse = await member.request(roomsPath, { name: 'Persisted launch', description: 'Shared outcome', agentIds: [agent.id] })
    expect(roomResponse.status).toBe(201)
    const { room } = await roomResponse.json() as { room: { id: string; members: unknown[] } }
    expect(room.members).toHaveLength(1)
    const roomPath = `${roomsPath}/${room.id}`
    expect((await admin.request(`/api/organizations/${otherOrganizationId}/rooms/${room.id}`)).status).toBe(404)
    expect((await member.request(`${roomPath}/star`, { starred: true })).status).toBe(200)
    const memberRooms = await (await member.request(roomsPath)).json() as { rooms: { stars: unknown[]; agents: { agent: { id: string } }[] }[] }
    expect(memberRooms.rooms[0].stars).toHaveLength(1)
    expect(memberRooms.rooms[0].agents[0].agent.id).toBe(agent.id)
    const adminRooms = await (await admin.request(roomsPath)).json() as typeof memberRooms
    expect(adminRooms.rooms[0].stars).toHaveLength(0)
    expect((await member.request(`${roomPath}/members`, { userId: 'not-a-member' })).status).toBe(400)
    expect((await admin.request(`${roomPath}/members`, {})).status).toBe(200)
    expect((await admin.request(`${roomPath}/read`, {})).status).toBe(200)
    expect((await member.request(roomPath, { name: 'Updated launch', description: 'Updated outcome', agentIds: [agent.id], status: 'WORKING' }, {}, 'PATCH')).status).toBe(200)
    const messageResponse = await member.request(`${roomPath}/messages`, { text: 'Hello team', authorAgentId: agent.id })
    expect(messageResponse.status).toBe(201)
    const { message } = await messageResponse.json() as { message: { id: string; authorUserId: string; authorAgentId: string | null } }
    expect(message.authorUserId).toBe(user.id)
    expect(message.authorAgentId).toBeNull()
    expect((await member.request(`${roomPath}/messages`, { text: 'Bad link', documents: [{ documentId: 'unknown' }] })).status).toBe(400)
    const documentResponse = await member.request(`${roomPath}/documents`, { title: 'Launch plan', kind: 'DOCUMENT' })
    expect(documentResponse.status).toBe(201)
    const { document } = await documentResponse.json() as { document: { id: string } }
    const documentPath = `${roomPath}/documents/${document.id}`
    expect((await member.request(`${documentPath}/content`)).status).toBe(200)
    const snapshot = { expectedVersionId: null, content: '# Goals\n\nShip together.', changeSummary: 'Initial plan' }
    expect((await member.request(`${documentPath}/versions`, snapshot)).status).toBe(503)
    if (!liveBaseURL) {
      Object.assign(env, { S3_BUCKET: 'integration-bucket', S3_REGION: 'us-east-1', S3_ENDPOINT: storageServer.url.origin,
        AWS_ACCESS_KEY_ID: 'test-access-key', AWS_SECRET_ACCESS_KEY: 'test-secret-key' })
      const versionResponse = await member.request(`${documentPath}/versions`, snapshot)
      expect(versionResponse.status).toBe(201)
      const { version } = await versionResponse.json() as { version: { id: string; checksum: string; versionNumber: number } }
      expect(version.versionNumber).toBe(1)
      expect(version.checksum).toHaveLength(64)
      const savedContent = await (await member.request(`${documentPath}/content`)).json() as { content: { text: string }; currentVersionId: string }
      expect(savedContent.content.text).toBe(snapshot.content)
      expect(savedContent.currentVersionId).toBe(version.id)
      const [storedKey, storedBody] = [...objects.entries()][0]
      objects.set(storedKey, 'corrupted snapshot')
      expect((await member.request(`${documentPath}/content`)).status).toBe(502)
      objects.set(storedKey, storedBody)
      expect((await member.request(`${documentPath}/versions`, snapshot)).status).toBe(409)
      const url = await (await member.request(`${documentPath}/versions/${version.id}/url`)).json() as { url: string }
      expect(new URL(url.url).searchParams.get('X-Amz-Expires')).toBe('900')
      expect(new URL(url.url).searchParams.has('X-Amz-Signature')).toBe(true)
      expect((await member.request(`${roomPath}/messages`, { text: 'Review this plan', documents: [{ documentId: document.id, documentVersionId: version.id }] })).status).toBe(201)
      failStorage = true
      expect((await member.request(`${documentPath}/versions`, { ...snapshot, expectedVersionId: version.id, content: 'Should not become current' })).status).toBe(502)
      failStorage = false
      expect((await db.document.findUniqueOrThrow({ where: { id: document.id } })).currentVersionId).toBe(version.id)
      const secondResponse = await member.request(`${documentPath}/versions`, { ...snapshot, expectedVersionId: version.id, content: 'Version two' })
      expect(secondResponse.status).toBe(201)
      expect((await db.documentVersion.count({ where: { documentId: document.id } }))).toBe(2)
      const foreignRoomResponse = await admin.request(`/api/organizations/${otherOrganizationId}/rooms`, { name: 'Other tenant' })
      const foreignRoom = await foreignRoomResponse.json() as { room: { id: string } }
      const foreignDocumentPath = `/api/organizations/${otherOrganizationId}/rooms/${foreignRoom.room.id}/documents/${document.id}`
      expect((await admin.request(`${foreignDocumentPath}/content`)).status).toBe(404)
      expect((await admin.request(`${foreignDocumentPath}/versions/${version.id}/url`)).status).toBe(404)
      await expect(Promise.resolve(db.roomAgent.create({ data: { organizationId, roomId: room.id, agentId: otherAgent.id, addedByUserId: user.id } }))).rejects.toThrow()
      await expect(Promise.resolve(db.roomMessage.create({ data: { organizationId, roomId: room.id, text: 'No author' } }))).rejects.toThrow()
      await expect(Promise.resolve(db.roomMessage.create({ data: { organizationId, roomId: room.id, text: 'Two authors', authorUserId: user.id, authorAgentId: agent.id } }))).rejects.toThrow()
      const otherDoc = await db.document.create({ data: { organizationId, roomId: room.id, title: 'Other doc', kind: 'DOCUMENT' } })
      await expect(Promise.resolve(db.document.update({ where: { id: otherDoc.id }, data: { currentVersionId: version.id } }))).rejects.toThrow()
    }
    const detail = await (await member.request(roomPath)).json() as { messages: { id: string }[]; room: { name: string } }
    expect(detail.room.name).toBe('Updated launch')
    expect(detail.messages.some((item) => item.id === message.id)).toBe(true)
    expect((await member.request(`${roomPath}/messages?before=unknown`)).status).toBe(400)
    expect((await member.request('/api/auth/organization/invite-member', { email: strangerEmail, role: 'owner', organizationId })).status).toBe(403)
    expect((await member.request('/api/auth/organization/create', { name: 'Forbidden', slug: `member-${tag}` })).status).toBe(403)
    let me = await (await member.request('/api/me')).json() as { activeOrganization: { id: string } | null; needsOrganizationSelection: boolean }
    expect(me.activeOrganization?.id).toBe(organizationId)
    // A fresh login automatically selects the sole membership.
    await member.signIn(invitedEmail)
    me = await (await member.request('/api/me')).json() as typeof me
    expect(me.activeOrganization?.id).toBe(organizationId)

    const secondInviteResponse = await admin.request('/api/auth/organization/invite-member', { email: invitedEmail, role: 'member', organizationId: otherOrganizationId })
    const secondInvite = await secondInviteResponse.json() as { id: string }
    expect((await member.request('/api/auth/organization/accept-invitation', { invitationId: secondInvite.id })).status).toBe(200)
    await member.signIn(invitedEmail)
    me = await (await member.request('/api/me')).json() as typeof me
    expect(me.activeOrganization).toBeNull()
    expect(me.needsOrganizationSelection).toBe(true)
    expect((await member.request('/api/auth/organization/set-active', { organizationId })).status).toBe(200)

    const membership = await db.member.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId: user.id } } })
    expect((await admin.request('/api/auth/organization/remove-member', { organizationId, memberIdOrEmail: membership.id })).status).toBe(200)
    expect((await member.request(`/api/organizations/${organizationId}`)).status).toBe(404)
    expect((await member.request(agentsPath)).status).toBe(404)
    expect((await member.request(`${agentsPath}/${agent.id}`, profile, {}, 'PATCH')).status).toBe(404)
    expect((await member.request(roomPath)).status).toBe(404)
    expect((await member.request(`${roomPath}/messages`, { text: 'Revoked' })).status).toBe(404)
    expect((await db.roomMessage.findUniqueOrThrow({ where: { id: message.id } })).authorUserId).toBe(user.id)

    const resetResponse = await member.request('/api/auth/request-password-reset', { email: invitedEmail, redirectTo: env.WEB_ORIGIN })
    expect(resetResponse.status).toBe(200)
    const resetMail = await db.emailMessage.findFirstOrThrow({ where: { recipient: invitedEmail, subject: 'Reset your Nautilus password' }, orderBy: { createdAt: 'desc' } })
    const resetUrl = new URL(resetMail.text.split('Reset your password: ')[1])
    const token = resetUrl.pathname.split('/').at(-1)
    expect((await member.request('/api/auth/reset-password', { token, newPassword: 'Replacement-password-2026!' })).status).toBe(200)
    expect((await member.request('/api/me')).status).toBe(401)

    const cors = await anonymous.request('/api/me', undefined, { Origin: 'https://untrusted.example.com' })
    expect(cors.headers.get('access-control-allow-origin')).toBeNull()
  } finally {
    storageServer.stop(true)
    // Only remove rows uniquely owned by this test run.
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } })
    await db.user.deleteMany({ where: { email: { in: recipients } } })
    await db.emailMessage.deleteMany({ where: { recipient: { in: recipients } } })
    await db.rateLimit.deleteMany({ where: { key: { startsWith: ipPrefix } } })
    await db.$disconnect()
  }
}, 180_000)
