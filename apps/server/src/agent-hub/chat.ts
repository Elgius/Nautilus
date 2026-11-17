import { buildHubCitations } from '../../../../shared/agent-citations'
import type { HubSource } from '../../../../shared/room-chat'
import { createDatabase, type Database } from '../db'
import { createKnowledgeSkill } from './knowledge'
import { createDiscoverySkill } from './discovery'
import { Hono } from 'hono'
import { createUIMessageStreamResponse, toUIMessageStream } from 'ai'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { createAgentModel, createLLMAgent, parseAgentChat } from '../ai'
import type { AppEnv } from '../index'
import { generationTimeoutMs, hubIds, hubOwner, reserveTurn } from '../hub-history'
import { personalAgentScope } from '../personal-agents'

// Mounted behind the existing session, live membership, and origin checks.
export const agentChat = new Hono<AppEnv>()
agentChat.post('/:agentId/chat', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
  const body = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'Enter a valid agent chat request.' })
  })
  const input = parseAgentChat(body)
  const history = body.history === undefined ? undefined : hubIds.safeParse(body.history)
  if (history && (!history.success || input.stream)) throw new HTTPException(400, { message: 'Invalid saved chat request.' })
  const owner = history?.success ? hubOwner(c) : undefined
  const profile = await c.get('db').agent.findFirst({
    where: { id: c.req.param('agentId'), ...personalAgentScope(c.get('organizationId'), c.get('session').user.id) },
    select: { id: true, name: true, role: true, rules: true },
  })
  if (!profile) throw new HTTPException(404, { message: 'Agent not found.' })
  const prompt = input.messages[input.messages.length - 1].content
  const model = createAgentModel(c.env)
  const identity = { organizationId: c.get('organizationId'), userId: c.get('session').user.id }
  const sessionId = owner ? undefined : c.get('session').session.id
  const authorize = async (db: Database) => {
    if (!await db.session.findFirst({ where: { id: sessionId, userId: identity.userId, expiresAt: { gt: new Date() } }, select: { id: true } }) ||
      !await db.member.findUnique({ where: { organizationId_userId: identity }, select: { id: true } })) throw new Error('Agent access expired.')
  }
  // Streamed tools may run after the HTTP middleware disconnects its request DB.
  const withDatabase = async <T>(action: (db: Database) => Promise<T>) => {
    const db = createDatabase(c.env.DATABASE_URL)
    try { await authorize(db); return await action(db) } finally { await db.$disconnect() }
  }
  const sources = new Map<string, HubSource>()
  const recordSources = async (incoming: HubSource[]) => { for (const source of incoming) sources.set(source.id, source) }
  // Saved profile chats retain their existing plain-text history contract.
  // Retrieval with revocable evidence belongs to the room-backed Hub history.
  const agent = createLLMAgent(profile, model, owner ? [] : [
    createDiscoverySkill(withDatabase, identity.organizationId, identity.userId),
    createKnowledgeSkill(withDatabase, identity, ['ORGANIZATION'], c.req.raw.signal, recordSources),
  ])
  const claimToken = crypto.randomUUID()
  if (owner && history?.success) {
    const turn = await reserveTurn(c.get('db'), owner, { ...history.data, agentId: profile.id, prompt, reply: '' }, claimToken)
    if (turn) return c.json({ agentId: profile.id, text: turn.reply, turn })
  }
  const generate = async () => {
    const abortSignal = owner ? AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(generationTimeoutMs)]) : c.req.raw.signal
    const options = { messages: input.messages, abortSignal }
    if (input.stream) {
      const result = await agent.stream(options)
      let responseText = ''
      return createUIMessageStreamResponse({
        stream: toUIMessageStream({
          stream: result.stream,
          // Provider errors may include credentials, prompts, or internal URLs.
          onError: () => 'The agent could not complete this response. Please try again.',
        }).pipeThrough(new TransformStream({ transform(chunk, controller) {
          if (chunk.type === 'text-delta') responseText += chunk.delta
          if (chunk.type === 'finish') controller.enqueue({ type: 'data-citations', data: { citations: buildHubCitations(responseText, [...sources.values()]) } })
          controller.enqueue(chunk)
        } })),
      })
    }
    const result = await agent.generate(options)
    return { text: result.text, citations: buildHubCitations(result.text, [...sources.values()]), finishReason: result.finishReason, usage: result.totalUsage }
  }
  try {
    const result = await generate().catch(() => {
      throw new HTTPException(502, { message: 'The agent could not complete this response. Please try again.' })
    })
    if (result instanceof Response) return result
    if (owner && history?.success) {
      if (!result.text.trim()) throw new HTTPException(502, { message: 'The agent returned an empty reply.' })
      const createdAt = new Date()
      const saved = await c.get('db').hubTurn.updateMany({
        where: { ...owner, id: history.data.id, claimToken }, data: { reply: result.text, claimToken: null, createdAt },
      })
      if (!saved.count) throw new HTTPException(409, { message: 'The request expired. Retry the message.' })
      const turn = { ...history.data, createdAt: createdAt.getTime(), agentId: profile.id, prompt, reply: result.text }
      return c.json({ ...result, agentId: profile.id, turn })
    }
    return c.json({ agentId: profile.id, ...result })
  } catch (error) {
    if (owner && history?.success) await c.get('db').hubTurn.deleteMany({ where: { ...owner, id: history.data.id, claimToken } })
    throw error
  }
})
