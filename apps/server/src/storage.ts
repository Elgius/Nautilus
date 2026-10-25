import { AwsClient } from 'aws4fetch'
import { HTTPException } from 'hono/http-exception'
import type { Bindings } from './env'

export function storageConfigured(env: Bindings) {
  return !!(env.S3_BUCKET && env.S3_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
}

export function createStorage(env: Bindings) {
  if (!storageConfigured(env)) throw new HTTPException(503, { message: 'Document storage is not configured. Set the S3 environment variables on the API.' })
  const aws = new AwsClient({ accessKeyId: env.AWS_ACCESS_KEY_ID!, secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    sessionToken: env.AWS_SESSION_TOKEN, service: 's3', region: env.S3_REGION!, retries: 2 })
  const base = env.S3_ENDPOINT
    ? `${env.S3_ENDPOINT.replace(/\/$/, '')}/${encodeURIComponent(env.S3_BUCKET!)}`
    : `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`
  const url = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
  return {
    async put(key: string, body: string) {
      const response = await aws.fetch(url(key), { method: 'PUT', body,
        headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new HTTPException(502, { message: 'Couldn’t upload the document. Please try again.' })
    },
    async get(key: string) {
      const response = await aws.fetch(url(key), { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new HTTPException(502, { message: 'Couldn’t load the document from storage.' })
      return response.text()
    },
    async downloadUrl(key: string) {
      const target = new URL(url(key))
      target.searchParams.set('X-Amz-Expires', '900')
      return (await aws.sign(target.toString(), { method: 'GET', aws: { signQuery: true } })).url
    },
  }
}
