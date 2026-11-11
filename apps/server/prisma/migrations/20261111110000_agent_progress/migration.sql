CREATE TABLE "agentProgress" (
  "organizationId" TEXT NOT NULL, "roomId" TEXT NOT NULL, "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "id" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL, "objective" TEXT NOT NULL,
  "completed" TEXT[] NOT NULL, "remaining" TEXT[] NOT NULL, "blockers" TEXT[] NOT NULL,
  "documents" JSONB NOT NULL, "status" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "createdRunId" TEXT NOT NULL, "updatedRunId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agentProgress_pkey" PRIMARY KEY ("organizationId", "roomId", "userId", "agentId", "id"),
  CONSTRAINT "agentProgress_status_check" CHECK ("status" IN ('active', 'blocked', 'complete')),
  CONSTRAINT "agentProgress_revision_check" CHECK ("revision" > 0)
);
ALTER TABLE "agentProgress" ADD CONSTRAINT "agentProgress_room_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agentProgress" ADD CONSTRAINT "agentProgress_owner_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agentProgress" ADD CONSTRAINT "agentProgress_agent_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "agent"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "agentProgressSave" (
  "organizationId" TEXT NOT NULL, "roomId" TEXT NOT NULL, "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL, "progressId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "runId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agentProgressSave_pkey" PRIMARY KEY ("organizationId", "roomId", "userId", "agentId", "requestId")
);
CREATE INDEX "agentProgressSave_progress_idx" ON "agentProgressSave"("organizationId", "roomId", "userId", "agentId", "progressId");
ALTER TABLE "agentProgressSave" ADD CONSTRAINT "agentProgressSave_progress_fkey" FOREIGN KEY ("organizationId", "roomId", "userId", "agentId", "progressId") REFERENCES "agentProgress"("organizationId", "roomId", "userId", "agentId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
