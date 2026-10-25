import { expect, test } from 'bun:test'
import { parseRoom, parseContent } from '../src/room-validation'
import { officeContent } from '../../web/lib/office-content'

test('room input normalizes fields and preserves distinct agent ID order', () => {
  expect(parseRoom({ name: ' Launch ', agentIds: ['a', 'b', 'a'], organizationId: 'injected' })).toEqual({
    name: 'Launch', description: '', category: 'General', status: 'READY', color: 'green', agentIds: ['a', 'b'],
  })
  for (const input of [{ name: '' }, { name: 'a'.repeat(71) }, { name: 'Room', status: 'invalid' },
    { name: 'Room', agentIds: [null] }, { name: 'Room', description: 'a'.repeat(601) }]) {
    expect(() => parseRoom(input)).toThrow()
  }
})

test('Univer snapshots preserve formatting and reject mismatched or malformed workbooks', () => {
  const doc = officeContent('DOCUMENT', 'doc', 'Brief')
  expect(JSON.parse(parseContent('DOCUMENT', doc))).toEqual(doc)
  expect(() => parseContent('SPREADSHEET', doc)).toThrow()
  const sheet = officeContent('SPREADSHEET', 'workbook', 'Budget')
  expect(JSON.parse(parseContent('SPREADSHEET', sheet))).toEqual(sheet)
  if (sheet.kind !== 'SPREADSHEET') throw new Error('Wrong kind')
  sheet.snapshot.sheetOrder = ['missing']
  expect(() => parseContent('SPREADSHEET', sheet)).toThrow()
  const invalidDoc = { ...doc, snapshot: { id: 'doc', body: { dataStream: 'missing terminators' }, documentStyle: {} } }
  expect(() => parseContent('DOCUMENT', invalidDoc)).toThrow()
  const injected = JSON.parse('{"format":"univer","kind":"DOCUMENT","snapshot":{"id":"a","body":{"dataStream":"\\r\\n"},"documentStyle":{},"__proto__":{}}}')
  expect(() => parseContent('DOCUMENT', injected)).toThrow()
})

test('document snapshot serialization validates text and spreadsheet structures', () => {
  expect(JSON.parse(parseContent('DOCUMENT', '# Hello'))).toEqual({ format: 'markdown', text: '# Hello' })
  const sheet = { id: 1, name: 'Budget', cells: [Array(8).fill('')] }
  expect(JSON.parse(parseContent('SPREADSHEET', { sheets: [sheet] })).sheets).toEqual([sheet])
  for (const input of [{}, { sheets: [] }, { sheets: [{ ...sheet, cells: [] }] }, { sheets: [sheet, sheet] },
    { sheets: [{ ...sheet, cells: [[5]] }] }, { sheets: [sheet], styles: { '1:0:0': { bold: 'yes' } } }]) {
    expect(() => parseContent('SPREADSHEET', input)).toThrow()
  }
})
