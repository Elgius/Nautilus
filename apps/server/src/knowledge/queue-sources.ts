import type { Prisma } from '../generated/prisma/client'

// Findings belong to a source, so agents sharing a room share one source check.
// Rooms with no assigned agent keep their existing automatic Knowledge checks.
export function queueSources(tx: Prisma.TransactionClient, baseId: string, now: Date, agentId: string | null = null, defaultScheduleOnly = false) {
  return tx.$executeRaw`INSERT INTO "knowledgeRun" (id, "sourceId", "sourceRevision", trigger, "createdAt", "nextAttemptAt")
    SELECT gen_random_uuid()::text, s.id, s.revision, COALESCE('agent:' || assigned."agentId", 'refresh'), ${now}, ${now}
    FROM "knowledgeSource" s JOIN "knowledgeBase" b ON b.id = s."knowledgeBaseId"
    LEFT JOIN LATERAL (
      SELECT r."agentId" FROM "roomAgent" r
      WHERE r."organizationId" = s."organizationId" AND r."roomId" = s."roomId"
        AND NOT (r."agentId" = ANY(b."pausedAgentIds"))
        AND (${agentId}::text IS NULL OR r."agentId" = ${agentId})
        AND (NOT ${defaultScheduleOnly} OR NOT EXISTS (
          SELECT 1 FROM "knowledgeAgentSchedule" schedule WHERE schedule."agentId" = r."agentId" AND schedule."baseId" = b.id
        ))
      ORDER BY r.position, r."agentId" LIMIT 1
    ) assigned ON true
    WHERE b.id = ${baseId} AND b.enabled AND s."revokedAt" IS NULL
      AND (assigned."agentId" IS NOT NULL OR (${agentId}::text IS NULL AND NOT EXISTS (
        SELECT 1 FROM "roomAgent" r WHERE r."roomId" = s."roomId" AND r."organizationId" = s."organizationId"
      )))
    ON CONFLICT DO NOTHING`
}
