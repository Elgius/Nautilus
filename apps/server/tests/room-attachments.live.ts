// Opt-in smoke test against an already running local server and configured Bunny
// bucket. Creates isolated fixtures and removes them; never starts a server.
import assert from 'node:assert/strict'
import { hashPassword } from 'better-auth/crypto'
import { createDatabase } from '../scripts/db'
import { createStorage } from '../src/storage'
import type { Bindings } from '../src/env'

const base = process.env.TEST_BASE_URL || 'http://localhost:8787'
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Only an existing local server may be tested.')
const db = createDatabase(process.env.DATABASE_URL!)
const storage = createStorage(process.env as unknown as Bindings)
const tag = crypto.randomUUID(), userId = crypto.randomUUID(), orgId = crypto.randomUUID(), roomId = crypto.randomUUID()
const otherOrgId = crypto.randomUUID(), otherRoomId = crypto.randomUUID()
const password = `test-${crypto.randomUUID()}`, email = `storage-${tag}@example.com`
let cookie = ''
const path = `/api/organizations/${orgId}/rooms/${roomId}`
const request = (url: string, init: RequestInit = {}) => fetch(`${base}${url}`, {
  ...init, headers: { Cookie: cookie, Origin: process.env.WEB_ORIGIN!, ...init.headers },
})
try {
  await db.user.create({ data: { id: userId, name: 'Storage test', email, emailVerified: true,
    accounts: { create: { id: crypto.randomUUID(), providerId: 'credential', accountId: userId, password: await hashPassword(password) } } } })
  await db.organization.create({ data: { id: orgId, name: 'Storage test', slug: `storage-${tag}`,
    members: { create: { id: crypto.randomUUID(), userId, role: 'owner' } },
    rooms: { create: { id: roomId, name: 'Storage test', createdByUserId: userId } } } })
  await db.organization.create({ data: { id: otherOrgId, name: 'Other storage test', slug: `storage-other-${tag}`,
    rooms: { create: { id: otherRoomId, name: 'Other storage test', createdByUserId: userId } } } })
  assert.equal((await request(`${path}/attachments`)).status, 401)
  const login = await request('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  assert.equal(login.status, 200)
  cookie = login.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ')
  assert.ok(cookie)
  assert.equal((await request(`/api/organizations/${otherOrgId}/rooms/${otherRoomId}/attachments`)).status, 404)
  const bytes = new Uint8Array([0, 255, 13, 10, 128, 65, 66])
  const form = new FormData(); form.set('file', new File([bytes], `nautilus-${tag}.bin`, { type: 'application/octet-stream' }))
  const upload = await request(`${path}/attachments`, { method: 'POST', body: form })
  assert.equal(upload.status, 201, `Upload failed (${upload.status}): ${await upload.clone().text()}`)
  const { attachment } = await upload.json() as { attachment: { id: string; sizeBytes: number; checksum: string } }
  assert.equal(attachment.sizeBytes, bytes.length)
  const list = await (await request(`${path}/attachments`)).json() as { attachments: { id: string }[] }
  assert.ok(list.attachments.some((item) => item.id === attachment.id))
  const detail = await (await request(path)).json() as { storageConfigured: boolean }
  assert.equal(detail.storageConfigured, true)
  const download = await request(`${path}/attachments/${attachment.id}/url`)
  assert.equal(download.status, 200)
  const { url } = await download.json() as { url: string }
  const original = await fetch(url)
  assert.equal(original.status, 200)
  assert.match(original.headers.get('content-disposition') || '', /attachment/)
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes)
  assert.equal((await request(`${path}/attachments/${attachment.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await request(`${path}/attachments/${attachment.id}/url`)).status, 404)
  assert.equal((await fetch(url)).status, 404)
  // Existing document saves must use the same configured bucket, too.
  const created = await request(`${path}/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Storage test document', kind: 'DOCUMENT' }) })
  assert.equal(created.status, 201)
  const { document } = await created.json() as { document: { id: string } }
  const content = 'Persisted Bunny document test'
  const save = await request(`${path}/documents/${document.id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersionId: null, content }) })
  assert.equal(save.status, 201, `Document save failed: ${await save.clone().text()}`)
  const read = await (await request(`${path}/documents/${document.id}/content`)).json() as { content: unknown }
  assert.deepEqual(read.content, { format: 'markdown', text: content })
  console.log('PASS: authentication, tenant isolation, binary upload, persistent listing, signed download, exact contents, delete/404, document save/reload.')
} finally {
  // Remove only fixtures created above, including objects from failed assertions.
  const attachments = await db.roomAttachment.findMany({ where: { organizationId: orgId } })
  for (const item of attachments) { await storage.delete(item.objectKey); await db.roomAttachment.delete({ where: { id: item.id } }) }
  const versions = await db.documentVersion.findMany({ where: { organizationId: orgId } })
  for (const version of versions) await storage.delete(version.objectKey)
  await db.document.updateMany({ where: { organizationId: orgId }, data: { currentVersionId: null } })
  await db.documentVersion.deleteMany({ where: { organizationId: orgId } })
  await db.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } })
  await db.user.deleteMany({ where: { id: userId } })
  await db.$disconnect()
}
