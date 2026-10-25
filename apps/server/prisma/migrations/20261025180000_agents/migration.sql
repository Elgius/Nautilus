-- CreateEnum
CREATE TYPE "AgentColor" AS ENUM ('violet', 'coral', 'blue', 'green');

-- CreateEnum
CREATE TYPE "AgentIcon" AS ENUM ('bot', 'sparkles', 'compass', 'code', 'book', 'chart');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('Working', 'Available');

-- CreateTable
CREATE TABLE "agent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "nameKey" TEXT NOT NULL,
    "role" VARCHAR(70) NOT NULL,
    "color" "AgentColor" NOT NULL DEFAULT 'violet',
    "avatarIcon" "AgentIcon" NOT NULL DEFAULT 'bot',
    "avatarUrl" TEXT,
    "rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AgentStatus" NOT NULL DEFAULT 'Available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_organizationId_createdAt_idx" ON "agent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agent_organizationId_nameKey_key" ON "agent"("organizationId", "nameKey");

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
