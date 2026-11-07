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
    async put(key: string, body: string | ArrayBuffer, contentType = 'application/json') {
      const response = await aws.fetch(url(key), { method: 'PUT', body,
        headers: { 'Content-Type': contentType, 'If-None-Match': '*' }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new HTTPException(502, { message: 'Couldn’t upload the document. Please try again.' })
    },
    async get(key: string) {
      const response = await aws.fetch(url(key), { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new HTTPException(502, { message: 'Couldn’t load the document from storage.' })
      return response.text()
    },
    async delete(key: string) {
      const response = await aws.fetch(url(key), { method: 'DELETE', signal: AbortSignal.timeout(30_000) })
      if (!response.ok && response.status !== 404) throw new HTTPException(502, { message: 'Couldn’t remove the file from storage. Please try again.' })
    },
    async downloadUrl(key: string, filename?: string) {
      const target = new URL(url(key))
      target.searchParams.set('X-Amz-Expires', '900')
      if (filename) {
        target.searchParams.set('response-content-disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`)
        target.searchParams.set('response-content-type', 'application/octet-stream')
      }
      return (await aws.sign(target.toString(), { method: 'GET', aws: { signQuery: true } })).url
    },
  }
}
