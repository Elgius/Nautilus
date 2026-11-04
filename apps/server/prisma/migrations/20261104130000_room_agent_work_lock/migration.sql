ALTER TABLE "room" ADD COLUMN "agentWorkToken" TEXT,
ADD COLUMN "agentWorkExpiresAt" TIMESTAMP(3);

ALTER TABLE "room" ADD CONSTRAINT "room_agent_work_lease_pair"
CHECK (("agentWorkToken" IS NULL) = ("agentWorkExpiresAt" IS NULL));
