import { expect, test } from 'bun:test'
import { createOfficeApp } from '../src/app'
import { officeContent } from '../../web/lib/office-content'

const token = 'test-only-office-service-token-1234567890'
const app = createOfficeApp(token)
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

test('conversion requires authentication and configuration', async () => {
  expect((await app.request('/export', { method: 'POST', body: '{}' })).status).toBe(401)
  expect((await createOfficeApp('').request('/export', { method: 'POST', body: '{}' })).status).toBe(503)
})

test('Word export and reimport preserve text and a subsequent edit', async () => {
  const content = officeContent('DOCUMENT', 'test-doc', 'Brief', { format: 'markdown', text: 'Original text' })
  const exported = await app.request('/export', { method: 'POST', headers, body: JSON.stringify(content) })
  expect(exported.status).toBe(200)
  expect(exported.headers.get('Content-Type')).toContain('wordprocessingml')
  const form = new FormData()
  form.set('file', new File([await exported.arrayBuffer()], 'brief.docx'))
  const imported = await app.request('/import/DOCUMENT', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  expect(imported.status).toBe(200)
  const result = await imported.json()
  expect(result.content.snapshot.body.dataStream).toContain('Original text')
  result.content.snapshot.body.dataStream = result.content.snapshot.body.dataStream.replace('Original', 'Edited')
  const edited = await app.request('/export', { method: 'POST', headers, body: JSON.stringify(result.content) })
  expect(edited.status).toBe(200)
  const nextForm = new FormData()
  nextForm.set('file', new File([await edited.arrayBuffer()], 'edited.docx'))
  const reopened = await app.request('/import/DOCUMENT', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: nextForm })
  expect((await reopened.json()).content.snapshot.body.dataStream).toContain('Edited text')
})

test('Excel export and reimport retain multiple sheets, formulas, styles and calculated values', async () => {
  const content = officeContent('SPREADSHEET', 'test-book', 'Budget', { format: 'spreadsheet', sheets: [
    { id: 1, name: 'Budget', cells: [['12', '8', '=SUM(A1:B1)']] },
    { id: 2, name: 'Notes', cells: [['Keep me']] },
  ], styles: { '1:0:2': { bold: true } } })
  const exported = await app.request('/export', { method: 'POST', headers, body: JSON.stringify(content) })
  expect(exported.status).toBe(200)
  const form = new FormData()
  form.set('file', new File([await exported.arrayBuffer()], 'budget.xlsx'))
  const imported = await app.request('/import/SPREADSHEET', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  expect(imported.status).toBe(200)
  const { content: { snapshot } } = await imported.json()
  const [first, second] = snapshot.sheetOrder.map((id: string) => snapshot.sheets[id])
  expect(first.name).toBe('Budget')
  expect(second.name).toBe('Notes')
  expect(first.cellData[0][2].f).toBe('=SUM(A1:B1)')
  expect(Number(first.cellData[0][2].v)).toBe(20)
  const style = first.cellData[0][2].s
  expect((typeof style === 'string' ? snapshot.styles[style] : style).bl).toBe(1)
  expect(second.cellData[0][0].v).toBe('Keep me')
})

test('conversion rejects wrong file types, empty files and malformed snapshots', async () => {
  const form = new FormData()
  form.set('file', new File(['not a document'], 'file.xlsx'))
  expect((await app.request('/import/DOCUMENT', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })).status).toBe(400)
  expect((await app.request('/export', { method: 'POST', headers, body: JSON.stringify({ format: 'univer', kind: 'DOCUMENT', snapshot: {} }) })).status).toBe(400)
})
