ALTER TABLE "roomMessage" ADD COLUMN "clientMessageId" TEXT;
CREATE UNIQUE INDEX "roomMessage_roomId_authorUserId_clientMessageId_key" ON "roomMessage"("roomId", "authorUserId", "clientMessageId");
