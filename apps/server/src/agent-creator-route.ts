import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { createAgentModel } from './ai'
import { generateAgentInstructions, parseAgentCreation, saveCreatedAgent } from './agent-creator'
import type { LanguageModel } from 'ai'
import type { Bindings } from './env'
import type { AppEnv } from './index'

// Mounted behind the same authentication, membership, and origin checks as agents.
export function createAgentCreatorRouter(resolveModel: (env: Bindings) => LanguageModel = createAgentModel) {
  const router = new Hono<AppEnv>()
  router.post('/', bodyLimit({ maxSize: 3 * 1024 * 1024 }), async (c) => {
    const input = parseAgentCreation(await c.req.json().catch(() => {
      throw new HTTPException(400, { message: 'Enter a valid agent description.' })
    }))
    const db = c.get('db')
    const organizationId = c.get('organizationId')
    const existing = await db.agent.findUnique({
      where: { organizationId_nameKey: { organizationId, nameKey: input.nameKey } }, select: { id: true },
    })
    if (existing) throw new HTTPException(409, { message: 'Choose a name that isn’t already used by another agent.' })
    const instructions = await generateAgentInstructions(input.description, resolveModel(c.env), c.req.raw.signal)
    const agent = await saveCreatedAgent(db, organizationId, input, instructions)
    return c.json({ agent }, 201)
  })

  return router
}

export const agentCreator = createAgentCreatorRouter()
