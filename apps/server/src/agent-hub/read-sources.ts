import type { HubSource } from '../../../../shared/room-chat'
import type { ChatIdentity } from '../room-chat-service'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
function locationId(locator: string) {
  let hash = 2166136261
  for (let index = 0; index < locator.length; index++) hash = Math.imul(hash ^ locator.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16)
}

/** Provenance comes from successful resource reads, not assistant claims or tool inputs alone. */
export function sourceForRead(name: string, input: unknown, output: unknown, identity: ChatIdentity, titles: Map<string, string>): HubSource[] {
  const args = object(input), result = object(output)
  if (name === 'listDocuments' && Array.isArray(result.documents)) {
    for (const raw of result.documents) { const doc = object(raw); if (typeof doc.id === 'string') titles.set(doc.id, text(doc.title).slice(0, 200)) }
  }
  if (name === 'readTask' && typeof result.id === 'string') {
    const quote = [text(result.title), text(result.description), `Status: ${text(result.status)}`, `Calendar date: ${text(result.date) || 'Unscheduled'}`].join('\n').slice(0, 500)
    return [{ id: `task-${result.id}-${result.revision}`, kind: 'task', taskId: result.id, revision: Number(result.revision), scope: 'ROOM', title: text(result.title).slice(0, 200) || 'Room task',
      roomId: identity.roomId, documentId: null, messageId: null, updatedAt: new Date().toISOString(), body: quote,
      citations: [{ locator: `Task revision ${result.revision}`, quote, documentVersionId: null }] }]
  }
  if (!['readDocument', 'readRange', 'readTable', 'readWorkbook', 'findText'].includes(name) || typeof args.documentId !== 'string' || typeof result.currentVersionId !== 'string') return []
  if (name === 'findText' && (!Array.isArray(result.result) || !result.result.length)) return []
  const data = object(result.result)
  const locator = name === 'readRange' ? `Sheet ${text(args.sheetId)}; row ${args.row}, column ${args.column}; ${args.rows} rows × ${args.columns} columns (zero-based)`
    : name === 'readTable' ? `Table ${text(args.tableId)}; row ${args.row ?? 0}, column ${args.column ?? 0}; ${args.rows ?? 'remaining'} rows × ${args.columns ?? 'remaining'} columns (zero-based)` : name === 'findText' ? `Search: ${text(args.text).slice(0, 200)}` : text(args.segmentId) || (name === 'readWorkbook' ? 'Workbook metadata' : 'Document body')
  const body = object(data.body)
  const quote = (text(body.dataStream) || (name === 'findText' ? text(args.text) : JSON.stringify(data.cells ?? data))).slice(0, 500)
  return [{ id: `document-${args.documentId}-${result.currentVersionId}-${locationId(JSON.stringify({ name, args }))}`, kind: 'document', scope: 'ROOM',
    title: titles.get(args.documentId) || text(data.title).slice(0, 200) || 'Saved room document', roomId: identity.roomId,
    documentId: args.documentId, messageId: null, updatedAt: new Date().toISOString(), body: quote,
    citations: [{ locator, quote, documentVersionId: result.currentVersionId }] }]
}
