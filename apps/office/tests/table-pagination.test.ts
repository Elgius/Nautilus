import { expect, test } from 'bun:test'
import { DocumentDataModel, LocaleService, SpacingRule, type IDocumentData } from '@univerjs/core'
import { DocumentSkeleton, DocumentViewModel } from '@univerjs/engine-render'
import { officeContent } from '../../web/lib/office-content'
import { applyDocumentEdits } from '../src/editing/docs'

// Fixed line spacing keeps these pagination tests independent of installed fonts.
function layout(snapshot: IDocumentData, incremental = false) {
  const model = new DocumentDataModel(structuredClone(snapshot))
  const view = new DocumentViewModel(model)
  const locale = new LocaleService()
  const skeleton = DocumentSkeleton.create(view, locale)
  try {
    if (incremental) {
      const generation = skeleton.startIncrementalLayout({ reason: 'edit', anchor: 0 })
      let complete = false
      for (let step = 0; step < 10000 && !complete; step++) complete = skeleton.stepIncrementalLayout(generation, 100, 1).complete
      expect(complete).toBe(true)
    } else skeleton.calculate()
    return skeleton.getSkeletonData()!.pages.map(page => [...page.skeTables.values()].map(table => ({
      height: table.height,
      rows: table.rows.map(row => ({ index: row.index, repeated: !!row.isRepeatRow, top: row.top, height: row.height })),
    })))
  } finally { skeleton.dispose(); view.dispose(); model.dispose(); locale.dispose() }
}

function fixture(flavor: 0 | 1, headerRow = true, lines = 4) {
  const base = officeContent('DOCUMENT', 'table-pagination', 'Table pagination', { format: 'markdown', text: '\n'.repeat(5) })
  if (base.kind !== 'DOCUMENT') throw new Error('Expected document')
  base.snapshot.documentStyle = { documentFlavor: flavor, pageSize: { width: 400, height: 240 }, marginTop: 20, marginBottom: 20, marginLeft: 20, marginRight: 20 }
  const content = applyDocumentEdits(base, [{ type: 'insertTable', index: 5, headerRow, cells: [
    ['Species', 'Length'], ['Minke whale' + '\n'.repeat(lines), '10 m'], ['Blue whale', '30 m'],
  ] }])
  for (const paragraph of content.snapshot.body!.paragraphs!) paragraph.paragraphStyle = { spacingRule: SpacingRule.EXACT, lineSpacing: 16 }
  return content
}

for (const flavor of [0, 1] as const) {
  test(`flavor ${flavor}: Enter above the table preserves the header as the page break moves through a row`, () => {
    let content = fixture(flavor)
    expect(layout(content.snapshot)[1][0].rows[0]).toMatchObject({ index: 0, repeated: true })
    for (let enters = 1; enters <= 9; enters++) {
      content = applyDocumentEdits(content, [{ type: 'insertText', index: 0, text: '\n' }])
      const pages = layout(content.snapshot)
      const parts = pages.flat()
      // When the whole table moves to page two, its original header replaces
      // the repeated copy. Neither a missing header nor a duplicate is valid.
      for (const part of parts) {
        expect(part.rows[0].index).toBe(0)
        expect(part.rows.filter(row => row.index === 0)).toHaveLength(1)
        expect(part.rows[0].repeated).toBe(part !== parts[0])
        for (let index = 1; index < part.rows.length; index++) {
          expect(part.rows[index].top).toBeGreaterThanOrEqual(part.rows[index - 1].top + part.rows[index - 1].height)
        }
        expect(part.height).toBeLessThanOrEqual(200)
      }
      expect(Object.values(content.snapshot.tableSource!)[0].tableRows[0].repeatHeaderRow).toBe(1)
    }
  })

  test(`flavor ${flavor}: a body row spanning several pages reserves room for each header`, () => {
    const pages = layout(fixture(flavor, true, 40).snapshot)
    expect(pages.length).toBeGreaterThan(3)
    for (const part of pages.flat()) {
      expect(part.rows[0].index).toBe(0)
      expect(part.height).toBeLessThanOrEqual(200)
      expect(part.rows[1].top).toBeGreaterThanOrEqual(part.rows[0].height)
    }
  })

  test(`flavor ${flavor}: unmarked headers are not repeated`, () => {
    const pages = layout(fixture(flavor, false, 40).snapshot)
    expect(pages.flat().flatMap(part => part.rows).filter(row => row.index === 0)).toHaveLength(1)
    expect(pages.flat().flatMap(part => part.rows).some(row => row.repeated)).toBe(false)
  })
}

for (const flavor of [0, 1] as const) {
  test(`flavor ${flavor}: incremental editing and full pagination agree on repeated headers`, () => {
    const content = applyDocumentEdits(fixture(flavor, true, 40), [{ type: 'insertText', index: 0, text: '\n' }])
    expect(layout(content.snapshot, true)).toEqual(layout(content.snapshot))
  })
}
