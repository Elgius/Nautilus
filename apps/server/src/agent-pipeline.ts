export type PipelineStage = 'received' | 'accepted' | 'dequeued' | 'model.started' | 'model.first-delta' | 'reply.first-delta' | 'output.sent' | 'committed' | 'complete' | 'failed'

/** Metadata only. Server durations use the server clock; client durations are separate. */
export function logPipeline(roomId: string, runId: string, stage: PipelineStage | 'browser.first-output', details: Record<string, number | string> = {}) {
  console.info('[agent-pipeline]', JSON.stringify({ timestamp: new Date().toISOString(), roomId, runId, stage, ...details }))
}
