import { buildHubCitations } from '../../../../shared/agent-citations'
import type { HubSource, PrivateAgentJob } from '../../../../shared/room-chat'

export const MAX_HUB_SOURCES = 64
export const MAX_HUB_JOB_BYTES = 110_000

/** Reject excess evidence before returning a tool read; never evict a cited source. */
export function mergeHubProvenance(job: PrivateAgentJob, incoming: HubSource[], inherited: NonNullable<PrivateAgentJob['knowledgeReferences']> = []) {
  const sources = new Map((job.sources ?? []).map((source) => [source.id, source]))
  const references = new Map((job.knowledgeReferences ?? []).map((source) => [source.id, source]))
  const remember = (source: { id: string; revision?: number }) => {
    const previous = references.get(source.id)
    if (previous && previous.revision !== source.revision) throw new Error('Knowledge changed during this conversation. Start a fresh request with current sources.')
    references.set(source.id, { id: source.id, revision: source.revision })
  }
  for (const source of inherited) remember(source)
  for (const source of incoming) {
    if (!source.kind || source.kind === 'knowledge') remember(source)
    sources.set(source.id, { ...source, title: source.title.slice(0, 200), body: source.body.slice(0, 400),
      citations: source.citations.slice(0, 2).map((citation) => ({ ...citation, quote: citation.quote.slice(0, 500), locator: citation.locator.slice(0, 400) })) })
  }
  if (sources.size > MAX_HUB_SOURCES || references.size > MAX_HUB_SOURCES) throw new Error('Too many sources. Narrow this request or start a new conversation.')
  const result = { sources: [...sources.values()], knowledgeReferences: [...references.values()] }
  assertHubJobSize({ ...job, ...result, citations: buildHubCitations(job.reply, result.sources) })
  return result
}

export function assertHubJobSize(job: PrivateAgentJob) {
  if (new TextEncoder().encode(JSON.stringify(job)).byteLength > MAX_HUB_JOB_BYTES) throw new Error('Response and evidence are too large. Narrow this request.')
}
