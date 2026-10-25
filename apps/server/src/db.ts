import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from './generated/prisma/client'

// Worker sockets must belong to the request that uses them; do not cache this globally.
export function createDatabase(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })
}

export type Database = ReturnType<typeof createDatabase>
