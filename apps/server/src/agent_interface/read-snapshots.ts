import { HTTPException } from 'hono/http-exception'

/** Pin each document's first successful snapshot for a single read-only run.
 * Coalesce simultaneous loads; fail rather than evict and mix versions.
 */
export function createSnapshotReader<T>(load: (id: string) => Promise<T>) {
  const snapshots = new Map<string, Promise<T>>()
  let bytes = 0
  return (id: string) => {
    const existing = snapshots.get(id)
    if (existing) return existing
    if (snapshots.size >= 10) throw new HTTPException(422, { message: 'Read at most ten documents per question. Narrow this request.' })
    const pending = load(id).then((saved) => {
      const size = new TextEncoder().encode(JSON.stringify(saved)).byteLength
      if (bytes + size > 8_000_000) throw new HTTPException(422, { message: 'Document snapshots exceed this question’s memory budget. Narrow this request.' })
      bytes += size
      return saved
    }).catch((error: unknown) => { snapshots.delete(id); throw error })
    snapshots.set(id, pending)
    return pending
  }
}
