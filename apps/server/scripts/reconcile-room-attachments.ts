import { config } from 'dotenv'
import { createDatabase } from './db'
import { createStorage } from '../src/storage'
import type { Bindings } from '../src/env'

config({ path: new URL('../.env', import.meta.url).pathname, quiet: true })
const db = createDatabase(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL!)
const storage = createStorage(process.env as unknown as Bindings)
// One hour exceeds upload timeouts; never clean up active uploads or READY files.
try {
  const records = await db.roomAttachment.findMany({ where: {
    OR: [{ state: 'PENDING', createdAt: { lt: new Date(Date.now() - 3_600_000) } }, { state: 'DELETING' }],
  }, take: 100, orderBy: { createdAt: 'asc' } })
  for (const record of records) {
    try {
      await storage.delete(record.objectKey)
      await db.roomAttachment.deleteMany({ where: { id: record.id, state: record.state } })
      console.log(`Cleaned attachment ${record.id}`)
    } catch {
      console.error(`Cleanup failed for attachment ${record.id}; retained for retry.`)
      process.exitCode = 1
    }
  }
} finally { await db.$disconnect() }
