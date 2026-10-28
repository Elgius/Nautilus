import { Hono } from 'hono'
import { createUIMessageStreamResponse, toUIMessageStream } from 'ai'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { createAgentModel, createLLMAgent, parseAgentChat } from './ai'
import type { AppEnv } from './index'

// Mounted behind the existing session, live membership, and origin checks.
export const agentChat = new Hono<AppEnv>()
agentChat.post('/:agentId/chat', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
  const input = parseAgentChat(await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'Enter a valid agent chat request.' })
  }))
  const profile = await c.get('db').agent.findFirst({
    where: { id: c.req.param('agentId'), organizationId: c.get('organizationId') },
    select: { id: true, name: true, role: true, rules: true },
  })
  if (!profile) throw new HTTPException(404, { message: 'Agent not found.' })
  const agent = createLLMAgent(profile, createAgentModel(c.env))
  try {
    const options = { messages: input.messages, abortSignal: c.req.raw.signal }
    if (input.stream) {
      const result = await agent.stream(options)
      return createUIMessageStreamResponse({
        stream: toUIMessageStream({
          stream: result.stream,
          // Provider errors may include credentials, prompts, or internal URLs.
          onError: () => 'The agent could not complete this response. Please try again.',
        }),
      })
    }
    const result = await agent.generate(options)
    return c.json({ agentId: profile.id, text: result.text, finishReason: result.finishReason, usage: result.totalUsage })
  } catch {
    throw new HTTPException(502, { message: 'The agent could not complete this response. Please try again.' })
  }
})
