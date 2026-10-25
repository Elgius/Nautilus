-- Align stored metadata with the editor/API's 10 MiB snapshot limit.
ALTER TABLE "documentVersion" DROP CONSTRAINT "documentVersion_valid_size";
ALTER TABLE "documentVersion" ADD CONSTRAINT "documentVersion_valid_size"
  CHECK ("sizeBytes" >= 0 AND "sizeBytes" <= 10485760);
