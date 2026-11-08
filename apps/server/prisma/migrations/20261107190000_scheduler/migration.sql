CREATE TABLE "schedulerEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "instruction" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "schedulerEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "schedulerSchedule" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "schedulerSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedulerSchedule_state_check" CHECK ("state" IN ('pending', 'started', 'cancelled'))
);
CREATE TABLE "schedulerDelivery" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "acceptedAt" TIMESTAMPTZ(3),
  "lastError" TEXT,
  CONSTRAINT "schedulerDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedulerDelivery_state_check" CHECK ("state" IN ('pending', 'dispatching', 'accepted', 'failed', 'cancelled')),
  CONSTRAINT "schedulerDelivery_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "schedulerEvent_organizationId_roomId_ownerUserId_idx" ON "schedulerEvent"("organizationId", "roomId", "ownerUserId");
CREATE INDEX "schedulerSchedule_state_scheduledAt_idx" ON "schedulerSchedule"("state", "scheduledAt");
CREATE UNIQUE INDEX "schedulerDelivery_scheduleId_agentId_key" ON "schedulerDelivery"("scheduleId", "agentId");
CREATE INDEX "schedulerDelivery_state_nextAttemptAt_idx" ON "schedulerDelivery"("state", "nextAttemptAt");
ALTER TABLE "schedulerEvent" ADD CONSTRAINT "schedulerEvent_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedulerEvent" ADD CONSTRAINT "schedulerEvent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedulerSchedule" ADD CONSTRAINT "schedulerSchedule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "schedulerEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedulerDelivery" ADD CONSTRAINT "schedulerDelivery_organizationId_agentId_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "agent"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedulerDelivery" ADD CONSTRAINT "schedulerDelivery_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedulerSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
