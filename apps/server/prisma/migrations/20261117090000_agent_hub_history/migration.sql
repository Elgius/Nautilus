BEGIN;
CREATE TABLE "hubConversation" (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "id" UUID NOT NULL,
  "agentId" TEXT NOT NULL,
  PRIMARY KEY ("organizationId", "userId", "id"),
  FOREIGN KEY ("organizationId","userId") REFERENCES "member" ("organizationId","userId") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("organizationId","agentId") REFERENCES "agent" ("organizationId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "hubConversation_organizationId_agentId_idx" ON "hubConversation" ("organizationId","agentId");
CREATE TABLE "hubTurn" (
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "prompt" TEXT NOT NULL,
  "reply" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("organizationId","userId","id"),
  FOREIGN KEY ("organizationId","userId","conversationId") REFERENCES "hubConversation" ("organizationId","userId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "hubTurn_organizationId_userId_conversationId_createdAt_idx" ON "hubTurn" ("organizationId","userId","conversationId","createdAt");
COMMIT;
