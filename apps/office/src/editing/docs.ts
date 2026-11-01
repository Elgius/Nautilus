import type { IDocumentData, IParagraphStyle, ITextStyle } from '@univerjs/core'
import { createEditingRuntime, preserveResources } from './runtime'
import { batch, contentSnapshot, editText, integer, patch, requireEdit } from './common'

export type DocumentContent = { format: 'univer'; kind: 'DOCUMENT'; snapshot: IDocumentData }
export type TextRange = { start: number; end: number; segmentId?: string }
export type DocumentEdit =
  | { type: 'insertText'; index: number; text: string; segmentId?: string }
  | ({ type: 'replaceText'; text: string; expectedText: string } & TextRange)
  | ({ type: 'deleteText'; expectedText: string } & TextRange)
  | ({ type: 'formatText'; style: ITextStyle } & TextRange)
  | { type: 'formatParagraph'; paragraphId: string; style: IParagraphStyle; segmentId?: string }

/** Read the complete Univer body, including style runs and stable paragraph IDs. */
export function readDocument(content: unknown, segmentId = '') {
  const snapshot = contentSnapshot('DOCUMENT', content) as unknown as IDocumentData
  const body = segmentId ? (snapshot.headers?.[segmentId] ?? snapshot.footers?.[segmentId])?.body : snapshot.body
  requireEdit(body, 'Document segment not found.')
  return structuredClone({ id: snapshot.id, title: snapshot.title, segmentId, body })
}

/** Literal, case-sensitive matches; offsets are UTF-16 and ends are exclusive. */
export function findText(content: unknown, text: string, segmentId = ''): TextRange[] {
  editText(text)
  requireEdit(text.length > 0, 'Search text cannot be empty.')
  const { body } = readDocument(content, segmentId)
  const matches: TextRange[] = []
  for (let index = body.dataStream.indexOf(text); index >= 0; index = body.dataStream.indexOf(text, index + text.length)) {
    if (index + text.length <= body.dataStream.length - 2) matches.push({ start: index, end: index + text.length, segmentId })
    requireEdit(matches.length <= 10_000, 'Too many text matches; narrow the search.')
  }
  return matches
}

/** Sequential edits on an isolated copy. Failure never mutates the caller's snapshot. */
export function applyDocumentEdits(content: unknown, edits: DocumentEdit[]): DocumentContent {
  const snapshot = contentSnapshot('DOCUMENT', content) as unknown as IDocumentData
  batch(edits)
  const runtime = createEditingRuntime()
  try {
    const document = runtime.api.createDocument(structuredClone(snapshot))
    for (const edit of edits) {
      requireEdit(edit.segmentId === undefined || typeof edit.segmentId === 'string', 'Invalid segment ID.')
      const segmentId = edit.segmentId ?? ''
      const body = readDocument({ format: 'univer', kind: 'DOCUMENT', snapshot: document.save() }, segmentId).body
      const limit = body.dataStream.length - 2
      let success: boolean
      if (edit.type === 'formatParagraph') {
        editText(edit.paragraphId, 'paragraph ID')
        patch(edit.style)
        const paragraph = document.getParagraph(edit.paragraphId, segmentId)
        requireEdit(paragraph, 'Paragraph not found.')
        success = paragraph.setStyle(edit.style)
      } else if (edit.type === 'insertText') {
        runtime.assertStructuralResources(snapshot.resources)
        integer(edit.index, 0, limit, 'insertion index')
        editText(edit.text)
        requireEdit(edit.text.length > 0 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(edit.text), 'Text contains unsupported document control characters.')
        success = document.insertText(edit.index, edit.text, segmentId)
      } else {
        requireEdit(['replaceText', 'deleteText', 'formatText'].includes(edit.type), 'Unknown document edit.')
        integer(edit.start, 0, limit, 'range start')
        integer(edit.end, edit.start + 1, limit, 'range end')
        const range = document.getTextRange(edit.start, edit.end, segmentId)
        if (edit.type === 'formatText') {
          patch(edit.style)
          success = range.setTextStyle(edit.style)
        } else {
          editText(edit.expectedText, 'expected text')
          requireEdit(range.getText() === edit.expectedText, 'Text changed; read the document again.')
          const replacement = edit.type === 'replaceText' ? edit.text : ''
          editText(replacement)
          if (replacement.replace(/\r\n|\n/g, '\r').length !== edit.end - edit.start) runtime.assertStructuralResources(snapshot.resources)
          requireEdit(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(replacement), 'Text contains unsupported document control characters.')
          const inheritedStyle = range.getCommonExplicitTextStyle()
          success = range.setText(replacement)
          const insertedLength = replacement.replace(/\r\n|\n/g, '\r').length
          if (success && insertedLength && Object.keys(inheritedStyle).length) {
            success = document.getTextRange(edit.start, edit.start + insertedLength, segmentId).setTextStyle(inheritedStyle)
          }
        }
      }
      requireEdit(success, 'Univer could not apply the document edit.')
    }
    const result: DocumentContent = { format: 'univer', kind: 'DOCUMENT', snapshot: preserveResources(snapshot, document.save()) }
    contentSnapshot('DOCUMENT', result)
    return result
  } finally { runtime.dispose() }
}

export const insertText = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'insertText' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'insertText' }])
export const replaceText = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'replaceText' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'replaceText' }])
export const deleteText = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'deleteText' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'deleteText' }])
export const formatText = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'formatText' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'formatText' }])
export const formatParagraph = (content: unknown, edit: Omit<Extract<DocumentEdit, { type: 'formatParagraph' }>, 'type'>) => applyDocumentEdits(content, [{ ...edit, type: 'formatParagraph' }])
