-- Existing creator identity is unknown: retain NULL rather than guessing ownership.
ALTER TABLE "agent" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "agent" ADD CONSTRAINT "agent_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "agent_organizationId_createdByUserId_idx" ON "agent"("organizationId", "createdByUserId");
ALTER TABLE "agentActivityRun" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "agentActivityRun" ADD COLUMN "issues" JSONB NOT NULL DEFAULT '[]';
