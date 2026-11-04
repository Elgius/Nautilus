import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from './index'

export const handleApiError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  // Error messages and Prisma metadata may contain credentials or query values.
  const code = 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : undefined
  if (code === 'P2002') {
    return c.json({ error: (c.req.path.includes('/agents') || c.req.path.includes('/agent_creator_agent'))
      ? 'Choose a name that isn’t already used by another agent.'
      : 'This record changed. Reload and try again.' }, 409)
  }
  if (code === 'P2025') return c.json({ error: 'Record not found.' }, 404)
  if (code === 'P2003') return c.json({ error: 'A related record is unavailable.' }, 400)
  console.error('API request failed', { path: c.req.path, errorType: error.name, ...(code ? { prismaCode: code } : {}) })
  if (code === 'P2021' || code === 'P2022') {
    return c.json({ error: 'The database schema is out of date. Apply pending database migrations and restart the server.' }, 503)
  }
  return c.json({ error: 'Internal server error.' }, 500)
}
