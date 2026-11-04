import { expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { handleApiError } from '../src/api-error'
import type { AppEnv } from '../src/index'

function request(error: Error, path = '/rooms') {
  const app = new Hono<AppEnv>()
  app.get('*', () => { throw error })
  app.onError(handleApiError)
  return app.request(path)
}

test('missing database tables/columns produce actionable 503s without leaking database details', async () => {
  const log = spyOn(console, 'error').mockImplementation(() => {})
  try {
    for (const code of ['P2021', 'P2022']) {
      const response = await request(Object.assign(new Error('postgres://SECRET@host/private query'), { code, meta: { column: 'PRIVATE_COLUMN' } }))
      expect(response.status).toBe(503)
      expect((await response.json() as { error: string }).error).toContain('Apply pending database migrations')
      expect(log.mock.calls.at(-1)?.[1]).toMatchObject({ prismaCode: code })
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_COLUMN')
  } finally { log.mockRestore() }
})

test('existing HTTP and Prisma conflict responses retain their status codes', async () => {
  expect((await request(new HTTPException(423, { message: 'Room is locked.' }))).status).toBe(423)
  for (const [code, status] of [['P2002', 409], ['P2025', 404], ['P2003', 400]] as const) {
    expect((await request(Object.assign(new Error('SECRET'), { code }))).status).toBe(status)
  }
})

test('unknown failures retain generic responses and do not log arbitrary error codes', async () => {
  const log = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const response = await request(Object.assign(new Error('SECRET'), { code: 'postgres://SECRET' }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error.' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
  } finally { log.mockRestore() }
})
