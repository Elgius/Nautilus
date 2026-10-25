import { PrismaNeon } from '@prisma/adapter-neon'
import { PrismaClient } from '../src/generated/prisma-tooling/client'

export function createDatabase(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })
}
