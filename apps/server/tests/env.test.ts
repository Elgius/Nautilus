import { describe, expect, test } from 'bun:test'
import { validateBindings, type Bindings } from '../src/env'

const local: Bindings = {
  DATABASE_URL: 'postgresql://localhost/test',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters',
  BETTER_AUTH_URL: 'http://localhost:8787',
  WEB_ORIGIN: 'http://localhost:3000',
  EMAIL_DELIVERY_MODE: 'outbox',
}

describe('deployment configuration', () => {
  test('local email outbox cannot be enabled on a public deployment', () => {
    expect(() => validateBindings(local)).not.toThrow()
    expect(() => validateBindings({ ...local, BETTER_AUTH_URL: 'https://api.example.com' })).toThrow('localhost')
  })
  test('production requires an email provider and a strong auth secret', () => {
    expect(() => validateBindings({ ...local, EMAIL_DELIVERY_MODE: 'resend' })).toThrow('RESEND_API_KEY')
    expect(() => validateBindings({ ...local, BETTER_AUTH_SECRET: 'short' })).toThrow('32')
    expect(() => validateBindings({ ...local, BETTER_AUTH_URL: 'https://api.example.com', WEB_ORIGIN: 'https://app.example.com', EMAIL_DELIVERY_MODE: 'resend', RESEND_API_KEY: 'test', EMAIL_FROM: 'test@example.com' })).not.toThrow()
  })
})
