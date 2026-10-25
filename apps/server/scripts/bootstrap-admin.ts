import { config } from 'dotenv'
import { hashPassword } from 'better-auth/crypto'
import { createDatabase } from './db'

config({ path: new URL('../.env', import.meta.url).pathname, quiet: true })

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12 || password.length > 128) {
  throw new Error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (12–128 characters).')
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const db = createDatabase(process.env.DATABASE_URL)
try {
  // Operator-only command; never expose bootstrap through HTTP.
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) throw new Error('User already exists; bootstrap will not promote users or replace credentials.')
  const passwordHash = await hashPassword(password)
  const id = crypto.randomUUID()
  await db.user.create({ data: {
    id, email, name: process.env.BOOTSTRAP_ADMIN_NAME || 'Platform Administrator',
    platformRole: 'admin', emailVerified: true,
    accounts: { create: {
      id: crypto.randomUUID(), providerId: 'credential', accountId: id, password: passwordHash,
    } },
  } })
  console.log(`Created platform administrator: ${email}`)
} finally {
  await db.$disconnect()
}
