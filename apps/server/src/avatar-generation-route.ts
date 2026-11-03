import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import type { LanguageModel } from 'ai'
import { createAgentModel } from './ai'
import { generateAvatarPreview, parseAvatarDescription } from './avatar-generation'
import type { Bindings } from './env'
import type { AppEnv } from './index'
import { AvatarRateLimitError } from './avatar-rate-limit'

// No agent record is needed and no generated design is persisted.
// The parent app supplies authentication, live membership, and origin checks.
export function createAvatarGenerationRouter(resolveModel: (env: Bindings) => LanguageModel = createAgentModel) {
  const router = new Hono<AppEnv>()
  router.post('/', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
    const description = parseAvatarDescription(await c.req.json().catch(() => {
      throw new HTTPException(400, { message: 'Enter a valid avatar description.' })
    }))
    try {
      const avatar = await generateAvatarPreview(description, resolveModel(c.env), c.req.raw.signal)
      return c.json({ avatar })
    } catch (error) {
      if (error instanceof AvatarRateLimitError) {
        if (error.retryAfterSeconds) c.header('Retry-After', String(error.retryAfterSeconds))
        return c.json({ error: error.message, code: error.quotaExhausted ? 'quota_exhausted' : 'rate_limited', retryAfterSeconds: error.retryAfterSeconds }, 429)
      }
      throw error
    }
  })
  return router
}

export const avatarGeneration = createAvatarGenerationRouter()
