-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('READY', 'WORKING', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "RoomMemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('DOCUMENT', 'SPREADSHEET');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'READY');

-- CreateTable
CREATE TABLE "room" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(70) NOT NULL,
    "description" VARCHAR(600) NOT NULL DEFAULT '',
    "category" VARCHAR(70) NOT NULL DEFAULT 'General',
    "status" "RoomStatus" NOT NULL DEFAULT 'READY',
    "color" VARCHAR(20) NOT NULL DEFAULT 'green',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roomMember" (
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "organizationMemberId" TEXT NOT NULL,
    "role" "RoomMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "roomMember_pkey" PRIMARY KEY ("roomId","organizationMemberId")
);

-- CreateTable
CREATE TABLE "roomAgent" (
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roomAgent_pkey" PRIMARY KEY ("roomId","agentId")
);

-- CreateTable
CREATE TABLE "roomStar" (
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roomStar_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateTable
CREATE TABLE "roomMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorAgentId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "roomMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "category" VARCHAR(70) NOT NULL DEFAULT 'Notes',
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorAgentId" TEXT,
    "changeSummary" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messageDocument" (
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersionId" TEXT,

    CONSTRAINT "messageDocument_pkey" PRIMARY KEY ("messageId","documentId")
);

-- CreateIndex
CREATE INDEX "room_organizationId_lastActivityAt_id_idx" ON "room"("organizationId", "lastActivityAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "room_organizationId_id_key" ON "room"("organizationId", "id");

-- CreateIndex
CREATE INDEX "roomMember_organizationId_organizationMemberId_idx" ON "roomMember"("organizationId", "organizationMemberId");

-- CreateIndex
CREATE INDEX "roomAgent_organizationId_agentId_idx" ON "roomAgent"("organizationId", "agentId");

-- CreateIndex
CREATE INDEX "roomAgent_addedByUserId_idx" ON "roomAgent"("addedByUserId");

-- CreateIndex
CREATE INDEX "roomStar_organizationId_userId_idx" ON "roomStar"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "roomMessage_roomId_createdAt_id_idx" ON "roomMessage"("roomId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "roomMessage_authorUserId_idx" ON "roomMessage"("authorUserId");

-- CreateIndex
CREATE INDEX "roomMessage_organizationId_authorAgentId_idx" ON "roomMessage"("organizationId", "authorAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "roomMessage_organizationId_roomId_id_key" ON "roomMessage"("organizationId", "roomId", "id");

-- CreateIndex
CREATE INDEX "document_organizationId_updatedAt_idx" ON "document"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "document_roomId_createdAt_idx" ON "document"("roomId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_organizationId_roomId_id_key" ON "document"("organizationId", "roomId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "documentVersion_objectKey_key" ON "documentVersion"("objectKey");

-- CreateIndex
CREATE INDEX "documentVersion_authorUserId_idx" ON "documentVersion"("authorUserId");

-- CreateIndex
CREATE INDEX "documentVersion_organizationId_authorAgentId_idx" ON "documentVersion"("organizationId", "authorAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "documentVersion_documentId_versionNumber_key" ON "documentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "documentVersion_organizationId_roomId_documentId_id_key" ON "documentVersion"("organizationId", "roomId", "documentId", "id");

-- CreateIndex
CREATE INDEX "messageDocument_organizationId_roomId_documentId_idx" ON "messageDocument"("organizationId", "roomId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "member_organizationId_id_key" ON "member"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_organizationId_id_key" ON "agent"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room" ADD CONSTRAINT "room_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomMember" ADD CONSTRAINT "roomMember_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomMember" ADD CONSTRAINT "roomMember_organizationId_organizationMemberId_fkey" FOREIGN KEY ("organizationId", "organizationMemberId") REFERENCES "member"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomAgent" ADD CONSTRAINT "roomAgent_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomAgent" ADD CONSTRAINT "roomAgent_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomAgent" ADD CONSTRAINT "roomAgent_organizationId_agentId_fkey" FOREIGN KEY ("organizationId", "agentId") REFERENCES "agent"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomStar" ADD CONSTRAINT "roomStar_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomStar" ADD CONSTRAINT "roomStar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomMessage" ADD CONSTRAINT "roomMessage_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomMessage" ADD CONSTRAINT "roomMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roomMessage" ADD CONSTRAINT "roomMessage_organizationId_authorAgentId_fkey" FOREIGN KEY ("organizationId", "authorAgentId") REFERENCES "agent"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_organizationId_roomId_id_currentVersionId_fkey" FOREIGN KEY ("organizationId", "roomId", "id", "currentVersionId") REFERENCES "documentVersion"("organizationId", "roomId", "documentId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "documentVersion" ADD CONSTRAINT "documentVersion_organizationId_roomId_documentId_fkey" FOREIGN KEY ("organizationId", "roomId", "documentId") REFERENCES "document"("organizationId", "roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentVersion" ADD CONSTRAINT "documentVersion_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentVersion" ADD CONSTRAINT "documentVersion_organizationId_authorAgentId_fkey" FOREIGN KEY ("organizationId", "authorAgentId") REFERENCES "agent"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messageDocument" ADD CONSTRAINT "messageDocument_organizationId_roomId_messageId_fkey" FOREIGN KEY ("organizationId", "roomId", "messageId") REFERENCES "roomMessage"("organizationId", "roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messageDocument" ADD CONSTRAINT "messageDocument_organizationId_roomId_documentId_fkey" FOREIGN KEY ("organizationId", "roomId", "documentId") REFERENCES "document"("organizationId", "roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messageDocument" ADD CONSTRAINT "messageDocument_organizationId_roomId_documentId_documentV_fkey" FOREIGN KEY ("organizationId", "roomId", "documentId", "documentVersionId") REFERENCES "documentVersion"("organizationId", "roomId", "documentId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Preserve attribution when organization membership changes.
ALTER TABLE "roomMessage" ADD CONSTRAINT "roomMessage_exactly_one_author"
  CHECK (("authorUserId" IS NOT NULL)::int + ("authorAgentId" IS NOT NULL)::int = 1);
ALTER TABLE "documentVersion" ADD CONSTRAINT "documentVersion_exactly_one_author"
  CHECK (("authorUserId" IS NOT NULL)::int + ("authorAgentId" IS NOT NULL)::int = 1);
ALTER TABLE "documentVersion" ADD CONSTRAINT "documentVersion_positive_number" CHECK ("versionNumber" > 0);
ALTER TABLE "documentVersion" ADD CONSTRAINT "documentVersion_valid_size" CHECK ("sizeBytes" >= 0 AND "sizeBytes" <= 1000000);
