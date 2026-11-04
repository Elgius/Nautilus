import { DurableObject } from 'cloudflare:workers'
import { HTTPException } from 'hono/http-exception'
import { createAgentModel } from './ai'
import { generateRoomSuggestions, RoomSuggestions, suggestionHistory } from './room-suggestions'
import type { Bindings } from './env'
import { createDatabase, type Database } from './db'
import { canChat, chatHistory, parseSend, saveChatMessage, type ChatIdentity } from './room-chat-service'
import { PrivateRoomAgents } from './private-room-agents'
import { streamPrivateRoomAgent } from './private-room-agent-stream'
import type { PrivateAgentEvent } from '../../../shared/room-chat'

type Attachment = { identity: ChatIdentity; window: number; count: number }
export class RoomChat extends DurableObject<Bindings> {
  private privateAgents?: PrivateRoomAgents
  private suggestions?: RoomSuggestions
  private get suggestionService() {
    return this.suggestions ??= new RoomSuggestions({
      storage: this.ctx.storage,
      canAccess: (identity) => this.withDatabase(async (db) => Boolean(await canChat(db, identity))),
      history: (identity) => this.withDatabase((db) => suggestionHistory(db, identity)),
      generate: (messages) => generateRoomSuggestions(messages, createAgentModel(this.env)),
    })
  }
  private async withDatabase<T>(operation: (db: Database) => Promise<T>) {
    const db = createDatabase(this.env.DATABASE_URL)
    try { return await operation(db) } finally { await db.$disconnect() }
  }
  private get agentService() {
    return this.privateAgents ??= new PrivateRoomAgents({
      storage: this.ctx.storage,
      profile: (identity, agentId) => this.withDatabase(async (db) => {
        const assignment = await db.roomAgent.findFirst({ where: { organizationId: identity.organizationId, roomId: identity.roomId, agentId }, select: { agent: { select: { id: true, name: true, role: true, rules: true } } } })
        return assignment?.agent ?? null
      }),
      canAccess: (identity) => this.withDatabase(async (db) => Boolean(await canChat(db, identity))),
      stream: (profile, messages, signal) => streamPrivateRoomAgent(this.env, profile, messages, signal),
      send: (identity, event) => this.sendPrivate(identity, event),
      waitUntil: (task) => this.ctx.waitUntil(task),
    })
  }
  // Filter BEFORE doing any send. Private payloads never enter broadcast().
  private async sendPrivate(owner: ChatIdentity, event: PrivateAgentEvent) {
    await this.withDatabase(async (db) => {
      await Promise.all(this.ctx.getWebSockets().map(async (peer) => {
        const { identity } = peer.deserializeAttachment() as Attachment
        if (identity.userId !== owner.userId || identity.organizationId !== owner.organizationId || identity.roomId !== owner.roomId) return
        try {
          if (!await canChat(db, identity)) { peer.close(4003, 'Room access expired'); return }
          peer.send(JSON.stringify(event))
        } catch { peer.close(1011, 'Reconnect') }
      }))
    })
  }
  private queue: Promise<void> = Promise.resolve()
  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/suggestions' && request.method === 'POST') {
      const identity = await request.json<ChatIdentity>()
      try {
        return Response.json(await this.suggestionService.get(identity), { headers: { 'Cache-Control': 'no-store' } })
      } catch (error) {
        const status = error instanceof HTTPException ? error.status : 503
        return Response.json({ error: 'Chat suggestions are unavailable.' }, { status, headers: { 'Cache-Control': 'no-store' } })
      }
    }
    if (url.pathname === '/ticket' && request.method === 'POST') {
      const identity = await request.json<ChatIdentity>()
      const ticket = crypto.randomUUID()
      // Tickets are never exposed as long-lived session credentials.
      const tickets = await this.ctx.storage.list<{ expires: number }>({ prefix: 'ticket:' })
      for (const [key, value] of tickets) if (value.expires < Date.now()) await this.ctx.storage.delete(key)
      await this.ctx.storage.put(`ticket:${ticket}`, { identity, expires: Date.now() + 30_000 })
      return Response.json({ ticket })
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' || request.headers.get('Origin') !== this.env.WEB_ORIGIN) return new Response('Forbidden', { status: 403 })
    const key = `ticket:${url.searchParams.get('ticket')}`
    const ticket = await this.ctx.storage.transaction(async (tx) => {
      const value = await tx.get<{ identity: ChatIdentity; expires: number }>(key)
      await tx.delete(key)
      return value
    })
    if (!ticket || ticket.expires < Date.now()) return new Response('Expired ticket', { status: 401 })
    const db = createDatabase(this.env.DATABASE_URL)
    try {
      if (!await canChat(db, ticket.identity)) return new Response('Forbidden', { status: 403 })
    } finally { await db.$disconnect() }
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ identity: ticket.identity, window: Date.now(), count: 0 } satisfies Attachment)
    await this.ctx.storage.setAlarm(Date.now() + 30_000)
    pair[1].send(JSON.stringify({ type: 'ready' }))
    return new Response(null, { status: 101, webSocket: pair[0] })
  }
  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const task = this.queue.then(() => this.handle(socket, raw))
    this.queue = task.catch(() => {})
    return task
  }
  private async handle(socket: WebSocket, raw: string | ArrayBuffer) {
    const db = createDatabase(this.env.DATABASE_URL)
    let requestId: string | undefined
    try {
      const state = socket.deserializeAttachment() as Attachment
      if (!await canChat(db, state.identity)) { socket.close(4003, 'Room access expired'); return }
      if (typeof raw !== 'string' || raw.length > 100_000) throw new Error('Invalid message size.')
      const input = JSON.parse(raw) as Record<string, unknown>
      if (!input || typeof input !== 'object') throw new Error('Invalid event.')
      requestId = typeof input.requestId === 'string' ? input.requestId.slice(0, 100) : undefined
      if (Date.now() - state.window > 10_000) { state.window = Date.now(); state.count = 0 }
      if (++state.count > 40) throw new Error('Too many events. Please wait a moment.')
      socket.serializeAttachment(state)
      if (input.type === 'agent.list') {
        const assignments = await db.roomAgent.findMany({ where: { organizationId: state.identity.organizationId, roomId: state.identity.roomId }, orderBy: { position: 'asc' }, select: { agent: { select: { id: true, name: true, role: true } } } })
        socket.send(JSON.stringify({ type: 'agent.list', agents: assignments.map(({ agent }) => agent) }))
      } else if (input.type === 'agent.history') {
        // Ignore all client-supplied owner/user IDs, including history requests.
        const jobs = await this.agentService.history(state.identity)
        socket.send(JSON.stringify({ type: 'agent.history', jobs }))
      } else if (input.type === 'agent.invoke') {
        await this.agentService.invoke(state.identity, input)
      } else if (input.type === 'send') {
        const parsed = parseSend(input)
        if (/(^|\s)@/.test(parsed.text)) throw new Error('Invalid room message. Select an agent to send an @ instruction privately.')
        const message = await saveChatMessage(db, state.identity, parsed)
        await this.broadcast(db, { type: 'message', message })
        socket.send(JSON.stringify({ type: 'ack', requestId, message }))
      } else if (input.type === 'typing') {
        await this.broadcast(db, { type: 'typing', userId: state.identity.userId, name: state.identity.name, expiresAt: Date.now() + 4000 })
      } else if (input.type === 'history' || input.type === 'sync') {
        if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 100)) throw new Error('Invalid cursor.')
        const direction = input.type === 'sync' && input.cursor ? 'after' : 'before'
        const page = await chatHistory(db, state.identity, input.cursor as string | undefined, direction)
        socket.send(JSON.stringify({ type: input.type, requestId, ...page }))
        if (input.type === 'sync') {
          const readers = await db.roomMember.findMany({ where: { organizationId: state.identity.organizationId, roomId: state.identity.roomId, lastReadAt: { not: null } }, select: { lastReadAt: true, member: { select: { userId: true } } } })
          for (const reader of readers) socket.send(JSON.stringify({ type: 'read', userId: reader.member.userId, readAt: reader.lastReadAt!.toISOString() }))
          await this.presence(db)
        }
      } else if (input.type === 'read') {
        const member = await canChat(db, state.identity)
        if (member) await db.roomMember.update({ where: { roomId_organizationMemberId: { roomId: state.identity.roomId, organizationMemberId: member.organizationMemberId } }, data: { lastReadAt: new Date() } })
        await this.broadcast(db, { type: 'read', userId: state.identity.userId, readAt: new Date().toISOString() })
      } else if (input.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }))
      else throw new Error('Unknown chat event.')
    } catch (error) {
      const message = error instanceof Error && /^(Invalid|Enter|Too many|Unknown)/.test(error.message) ? error.message : 'Could not complete the chat request. Please retry.'
      socket.send(JSON.stringify({ type: 'error', requestId, error: message }))
    } finally { await db.$disconnect() }
  }
  private async broadcast(db: Database, event: object) {
    const peers = this.ctx.getWebSockets()
    await Promise.all(peers.map(async (peer) => {
      const { identity } = peer.deserializeAttachment() as Attachment
      if (!await canChat(db, identity)) { peer.close(4003, 'Room access expired'); return }
      try { peer.send(JSON.stringify(event)) } catch { peer.close(1011, 'Reconnect') }
    }))
  }
  private async presence(db: Database) {
    const users = new Map<string, { id: string; name: string }>()
    for (const peer of this.ctx.getWebSockets()) {
      const { identity } = peer.deserializeAttachment() as Attachment
      if (await canChat(db, identity)) users.set(identity.userId, { id: identity.userId, name: identity.name ?? 'Member' })
    }
    await this.broadcast(db, { type: 'presence', users: [...users.values()] })
  }
  async alarm() {
    const db = createDatabase(this.env.DATABASE_URL)
    try {
      for (const socket of this.ctx.getWebSockets()) {
        const { identity } = socket.deserializeAttachment() as Attachment
        if (!await canChat(db, identity)) socket.close(4003, 'Room access expired')
      }
      await this.presence(db)
    } finally { await db.$disconnect() }
    if (this.ctx.getWebSockets().length) await this.ctx.storage.setAlarm(Date.now() + 30_000)
  }
  async webSocketClose(socket: WebSocket, code: number) {
    socket.close([1005, 1006, 1015].includes(code) ? 1000 : code)
    const db = createDatabase(this.env.DATABASE_URL)
    try { await this.presence(db) } finally { await db.$disconnect() }
  }
  webSocketError(socket: WebSocket) { socket.close(1011, 'Reconnect') }
}
