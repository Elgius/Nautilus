CREATE TABLE "knowledgeAgentSchedule" (
  "baseId" TEXT NOT NULL REFERENCES "knowledgeBase"(id) ON DELETE CASCADE,
  "agentId" TEXT NOT NULL REFERENCES "agent"(id) ON DELETE CASCADE,
  "refreshHours" INTEGER NOT NULL CHECK ("refreshHours" BETWEEN 1 AND 24),
  "nextRefreshAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("baseId", "agentId")
);
CREATE INDEX "knowledgeAgentSchedule_nextRefreshAt_idx" ON "knowledgeAgentSchedule" ("nextRefreshAt");
