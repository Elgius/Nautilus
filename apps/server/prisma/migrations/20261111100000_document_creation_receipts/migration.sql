CREATE TABLE "documentCreationReceipt" (
  "organizationId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "agentId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "documentCreationReceipt_pkey" PRIMARY KEY ("organizationId", "roomId", "userId", "requestId")
);
CREATE INDEX "documentCreationReceipt_organizationId_roomId_documentId_idx" ON "documentCreationReceipt"("organizationId", "roomId", "documentId");
ALTER TABLE "documentCreationReceipt" ADD CONSTRAINT "documentCreationReceipt_document_fkey" FOREIGN KEY ("organizationId", "roomId", "documentId") REFERENCES "document"("organizationId", "roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
