CREATE TABLE "roomAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roomAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "roomAttachment_state_check" CHECK ("state" IN ('PENDING', 'READY', 'DELETING')),
    CONSTRAINT "roomAttachment_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760)
);
CREATE UNIQUE INDEX "roomAttachment_objectKey_key" ON "roomAttachment"("objectKey");
CREATE INDEX "roomAttachment_organizationId_roomId_state_createdAt_idx" ON "roomAttachment"("organizationId", "roomId", "state", "createdAt");
CREATE INDEX "roomAttachment_uploadedByUserId_idx" ON "roomAttachment"("uploadedByUserId");
ALTER TABLE "roomAttachment" ADD CONSTRAINT "roomAttachment_organizationId_roomId_fkey" FOREIGN KEY ("organizationId", "roomId") REFERENCES "room"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "roomAttachment" ADD CONSTRAINT "roomAttachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
