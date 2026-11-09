CREATE TABLE "plannerTask" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(4000) NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'To do',
  "date" VARCHAR(10) NOT NULL DEFAULT '',
  "agentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "revision" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  CONSTRAINT "plannerTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plannerTask_status_check" CHECK ("status" IN ('To do', 'In progress', 'In review', 'Done')),
  CONSTRAINT "plannerTask_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "plannerTask_agentIds_check" CHECK (cardinality("agentIds") <= 5)
);
CREATE UNIQUE INDEX "plannerTask_organizationId_roomId_id_key" ON "plannerTask"("organizationId", "roomId", "id");
CREATE INDEX "plannerTask_organizationId_roomId_deletedAt_id_idx" ON "plannerTask"("organizationId", "roomId", "deletedAt", "id");
ALTER TABLE "plannerTask" ADD CONSTRAINT "plannerTask_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "plannerChange" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "agentId" TEXT,
  "runId" TEXT,
  "summary" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plannerChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plannerChange_taskId_revision_key" ON "plannerChange"("taskId", "revision");
ALTER TABLE "plannerChange" ADD CONSTRAINT "plannerChange_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "plannerTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedulerEvent" ADD COLUMN "taskId" TEXT;
ALTER TABLE "schedulerEvent" ADD CONSTRAINT "schedulerEvent_organizationId_roomId_taskId_fkey" FOREIGN KEY ("organizationId", "roomId", "taskId") REFERENCES "plannerTask"("organizationId", "roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedulerDelivery" ADD COLUMN "executionState" TEXT, ADD COLUMN "result" TEXT, ADD COLUMN "executionError" TEXT;
ALTER TABLE "schedulerDelivery" ADD CONSTRAINT "schedulerDelivery_executionState_check" CHECK ("executionState" IS NULL OR "executionState" IN ('queued', 'running', 'complete', 'failed'));
