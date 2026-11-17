import type { Database } from '../db'
import type { HubSource } from '../../../../shared/room-chat'
import type { KnowledgeIdentity } from '../knowledge/service'
import { hubKnowledge } from './knowledge'

/** Knowledge used for a shared mutation must also be evidence for its reviewer. */
export function createHubEvidence(identity: KnowledgeIdentity, withDatabase: <T>(action: (db: Database) => Promise<T>) => Promise<T>) {
  let sources = new Map<string, HubSource>()
  return {
    record: (incoming: HubSource[]) => {
      const next = new Map(sources)
      for (const source of incoming) if (source.scope === 'ORGANIZATION') next.set(source.id, source)
      if (next.size > 20 || JSON.stringify([...next.values()]).length > 60_000) throw new Error('Knowledge review context is too large. Narrow this request.')
      sources = next
    },
    reads: async () => {
      const reads = []
      for (const source of sources.values()) {
        const current = await withDatabase((db) => hubKnowledge(db, identity)({ scope: 'ORGANIZATION', sourceId: source.id }))
        if (!current.sources.some((entry) => entry.id === source.id && entry.revision === source.revision)) throw new Error('Knowledge changed or access expired. Retrieve the source again before using it for shared changes.')
        reads.push({ operation: 'readKnowledgeEntry', source })
      }
      return reads
    },
  }
}
