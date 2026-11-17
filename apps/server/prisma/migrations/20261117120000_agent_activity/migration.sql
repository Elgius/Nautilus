CREATE TABLE "agentActivityRun" (
  "organizationId" TEXT NOT NULL, "roomId" TEXT NOT NULL, "userId" TEXT NOT NULL, "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL, "agentName" TEXT NOT NULL, "title" VARCHAR(200) NOT NULL,
  "status" TEXT NOT NULL, "source" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "instruction" TEXT NOT NULL, "reply" TEXT NOT NULL, "error" TEXT,
  "activities" JSONB NOT NULL, "commits" JSONB NOT NULL, "taskCommits" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
  CONSTRAINT "agentActivityRun_pkey" PRIMARY KEY ("organizationId", "roomId", "userId", "id"),
  CONSTRAINT "agentActivityRun_status_check" CHECK ("status" IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
  CONSTRAINT "agentActivityRun_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "agentActivityRun_source_check" CHECK ("source" IN ('manual', 'scheduled'))
);
CREATE INDEX "agentActivityRun_organizationId_userId_createdAt_id_roomId_idx" ON "agentActivityRun"("organizationId", "userId", "createdAt", "id", "roomId");
CREATE INDEX "agentActivityRun_organizationId_userId_status_createdAt_idx" ON "agentActivityRun"("organizationId", "userId", "status", "createdAt");
ALTER TABLE "agentActivityRun" ADD CONSTRAINT "agentActivityRun_room_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agentActivityRun" ADD CONSTRAINT "agentActivityRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
