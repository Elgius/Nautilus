export type Bindings = {
  DATABASE_URL: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  WEB_ORIGIN: string
  EMAIL_DELIVERY_MODE: 'outbox' | 'resend'
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  S3_BUCKET?: string
  S3_REGION?: string
  S3_ENDPOINT?: string
  AWS_ACCESS_KEY_ID?: string
  AWS_SECRET_ACCESS_KEY?: string
  AWS_SESSION_TOKEN?: string
  OFFICE_SERVICE_URL?: string
  OFFICE_SERVICE_TOKEN?: string
}

export function isLocalDevelopment(env: Bindings) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.BETTER_AUTH_URL).hostname)
}

export function validateBindings(env: Bindings) {
  for (const key of ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'WEB_ORIGIN'] as const) {
    if (!env[key]) throw new Error(`Missing required binding: ${key}`)
  }
  if (env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  const webOrigin = new URL(env.WEB_ORIGIN)
  if (webOrigin.origin !== env.WEB_ORIGIN) throw new Error('WEB_ORIGIN must be an origin without a path')
  if (env.EMAIL_DELIVERY_MODE === 'outbox') {
    if (!isLocalDevelopment(env)) throw new Error('The email outbox is only available on localhost')
  } else if (env.EMAIL_DELIVERY_MODE !== 'resend' || !env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('Configure RESEND_API_KEY and EMAIL_FROM for email delivery')
  }
}
