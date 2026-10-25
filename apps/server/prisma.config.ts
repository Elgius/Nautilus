import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

config({ path: new URL('.env', import.meta.url).pathname, quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation/builds do not need credentials; migration commands do.
  datasource: process.env.DATABASE_URL_UNPOOLED ? { url: process.env.DATABASE_URL_UNPOOLED } : undefined,
})
