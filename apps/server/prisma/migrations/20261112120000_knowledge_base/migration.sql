-- CreateEnum
CREATE TYPE "KnowledgeScope" AS ENUM ('PERSONAL', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "knowledgeBase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "KnowledgeScope" NOT NULL,
    "ownerUserId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRefreshAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledgeSource" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "documentId" TEXT,
    "messageId" TEXT,
    "taggedByUserId" TEXT NOT NULL,
    "taggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastProcessedRevision" INTEGER,
    "lastProcessedVersionId" TEXT,
    "lastProcessedHash" TEXT,
    "lastError" TEXT,

    CONSTRAINT "knowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledgeEntry" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceRevision" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledgeEntryRevision" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledgeEntryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledgeCitation" (
    "id" TEXT NOT NULL,
    "entryRevisionId" TEXT NOT NULL,
    "documentVersionId" TEXT,
    "messageHash" TEXT,
    "locator" TEXT NOT NULL,
    "quote" VARCHAR(500) NOT NULL DEFAULT '',

    CONSTRAINT "knowledgeCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledgeRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trigger" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "nextChunk" INTEGER NOT NULL DEFAULT 0,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "documentVersionId" TEXT,
    "sourceHash" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledgeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledgeBase_enabled_nextRefreshAt_idx" ON "knowledgeBase"("enabled", "nextRefreshAt");

-- CreateIndex
CREATE UNIQUE INDEX "knowledgeBase_organizationId_id_key" ON "knowledgeBase"("organizationId", "id");

-- CreateIndex
CREATE INDEX "knowledgeSource_organizationId_roomId_idx" ON "knowledgeSource"("organizationId", "roomId");

-- CreateIndex
CREATE INDEX "knowledgeSource_knowledgeBaseId_revokedAt_id_idx" ON "knowledgeSource"("knowledgeBaseId", "revokedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledgeSource_knowledgeBaseId_documentId_key" ON "knowledgeSource"("knowledgeBaseId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledgeSource_knowledgeBaseId_messageId_key" ON "knowledgeSource"("knowledgeBaseId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledgeEntry_sourceId_key" ON "knowledgeEntry"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledgeEntryRevision_runId_key" ON "knowledgeEntryRevision"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledgeEntryRevision_entryId_revision_key" ON "knowledgeEntryRevision"("entryId", "revision");

-- CreateIndex
CREATE INDEX "knowledgeCitation_entryRevisionId_idx" ON "knowledgeCitation"("entryRevisionId");

-- CreateIndex
CREATE INDEX "knowledgeRun_status_nextAttemptAt_idx" ON "knowledgeRun"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "knowledgeRun_sourceId_createdAt_idx" ON "knowledgeRun"("sourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "knowledgeBase" ADD CONSTRAINT "knowledgeBase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeBase" ADD CONSTRAINT "knowledgeBase_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeSource" ADD CONSTRAINT "knowledgeSource_organizationId_knowledgeBaseId_fkey" FOREIGN KEY ("organizationId", "knowledgeBaseId") REFERENCES "knowledgeBase"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeSource" ADD CONSTRAINT "knowledgeSource_organizationId_roomId_documentId_fkey" FOREIGN KEY ("organizationId", "roomId", "documentId") REFERENCES "document"("organizationId", "roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeSource" ADD CONSTRAINT "knowledgeSource_organizationId_roomId_messageId_fkey" FOREIGN KEY ("organizationId", "roomId", "messageId") REFERENCES "roomMessage"("organizationId", "roomId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeSource" ADD CONSTRAINT "knowledgeSource_taggedByUserId_fkey" FOREIGN KEY ("taggedByUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeEntry" ADD CONSTRAINT "knowledgeEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeEntryRevision" ADD CONSTRAINT "knowledgeEntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "knowledgeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeEntryRevision" ADD CONSTRAINT "knowledgeEntryRevision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "knowledgeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeCitation" ADD CONSTRAINT "knowledgeCitation_entryRevisionId_fkey" FOREIGN KEY ("entryRevisionId") REFERENCES "knowledgeEntryRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledgeRun" ADD CONSTRAINT "knowledgeRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Nullable owners need partial indexes; UNIQUE(org, owner) alone permits duplicate shared bases.
ALTER TABLE "knowledgeBase" ADD CONSTRAINT "knowledgeBase_owner_scope_check"
  CHECK ((scope = 'PERSONAL' AND "ownerUserId" IS NOT NULL) OR (scope = 'ORGANIZATION' AND "ownerUserId" IS NULL));
CREATE UNIQUE INDEX "knowledgeBase_personal_key" ON "knowledgeBase" ("organizationId", "ownerUserId") WHERE scope = 'PERSONAL';
CREATE UNIQUE INDEX "knowledgeBase_organization_key" ON "knowledgeBase" ("organizationId") WHERE scope = 'ORGANIZATION';
ALTER TABLE "knowledgeSource" ADD CONSTRAINT "knowledgeSource_exactly_one_source_check"
  CHECK (("documentId" IS NOT NULL)::int + ("messageId" IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX "knowledgeRun_active_source_key" ON "knowledgeRun" ("sourceId") WHERE status IN ('pending', 'running');
ALTER TABLE "knowledgeRun" ADD CONSTRAINT "knowledgeRun_status_check" CHECK (status IN ('pending', 'running', 'complete', 'cancelled', 'failed'));

-- All writers (browser, agent, or API) invalidate old findings and request a refresh.
-- No file-picker/import hook is involved: only persisted document heads count.
CREATE FUNCTION knowledge_document_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."currentVersionId" IS DISTINCT FROM NEW."currentVersionId" OR OLD.title IS DISTINCT FROM NEW.title THEN
    UPDATE "knowledgeSource" SET revision = revision + 1
      WHERE "documentId" = NEW.id AND "revokedAt" IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_document_changed AFTER UPDATE OF "currentVersionId", title ON document
  FOR EACH ROW EXECUTE FUNCTION knowledge_document_changed();
CREATE FUNCTION knowledge_message_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.text IS DISTINCT FROM NEW.text THEN
    UPDATE "knowledgeSource" SET revision = revision + 1
      WHERE "messageId" = NEW.id AND "revokedAt" IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_message_changed AFTER UPDATE OF text ON "roomMessage"
  FOR EACH ROW EXECUTE FUNCTION knowledge_message_changed();
CREATE FUNCTION knowledge_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "knowledgeBase" SET "nextRefreshAt" = LEAST("nextRefreshAt", CURRENT_TIMESTAMP)
    WHERE id = NEW."knowledgeBaseId";
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_source_changed AFTER INSERT OR UPDATE OF revision ON "knowledgeSource"
  FOR EACH ROW EXECUTE FUNCTION knowledge_source_changed();

ALTER TABLE "knowledgeCitation" ADD CONSTRAINT "knowledgeCitation_exactly_one_snapshot_check"
  CHECK (("documentVersionId" IS NOT NULL)::int + ("messageHash" IS NOT NULL)::int = 1);
