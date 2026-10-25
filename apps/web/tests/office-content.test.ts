import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeContent } from '../lib/office-content';

test('existing documents retain every character when opened in Univer', () => {
  const result = officeContent('DOCUMENT', 'd', 'Brief', { format: 'markdown', text: '# Heading\n\nOriginal text' });
  if (result.kind !== 'DOCUMENT') throw new Error('Wrong kind');
  assert.equal(result.snapshot.body?.dataStream, '# Heading\r\rOriginal text\r\n');
  assert.deepEqual(result.snapshot.body?.paragraphs?.map((paragraph) => paragraph.startIndex), [9, 10, 24]);
});

test('legacy sheets retain formulas, values, formatting and sheet order', () => {
  const result = officeContent('SPREADSHEET', 'w', 'Budget', { format: 'spreadsheet',
    sheets: [{ id: 3, name: 'Budget', cells: [['12', '8', '=SUM(A1:B1)']] }, { id: 4, name: 'Notes', cells: [['Keep me']] }],
    styles: { '3:0:2': { bold: true, italic: true } },
  });
  if (result.kind !== 'SPREADSHEET') throw new Error('Wrong kind');
  assert.deepEqual(result.snapshot.sheetOrder, ['3', '4']);
  assert.deepEqual(result.snapshot.sheets['3'].cellData?.[0]?.[0], { v: 12, t: 2 });
  assert.deepEqual(result.snapshot.sheets['3'].cellData?.[0]?.[2], { f: '=SUM(A1:B1)', s: { bl: 1, it: 1 } });
  assert.deepEqual(result.snapshot.sheets['4'].cellData?.[0]?.[0], { v: 'Keep me', t: 1 });
});

test('native snapshots retain editor resources and cannot cross document kinds', () => {
  const content = officeContent('DOCUMENT', 'd', 'Brief');
  content.snapshot.resources = [{ name: 'custom', data: '{"keep":true}' }];
  assert.equal(officeContent('DOCUMENT', 'd', 'Brief', content), content);
  assert.throws(() => officeContent('SPREADSHEET', 'd', 'Wrong', content));
});

test('legacy numeric-looking identifiers and precision remain intact', () => {
  const content = officeContent('SPREADSHEET', 'id', 'Identifiers', { format: 'spreadsheet', sheets: [
    { id: 1, name: 'Data', cells: [['00123', '1.00', '9007199254740993', '42']] },
  ], styles: {} });
  if (content.kind !== 'SPREADSHEET') throw new Error('Wrong kind');
  const row = content.snapshot.sheets['1'].cellData?.[0];
  assert.equal(row?.[0]?.v, '00123');
  assert.equal(row?.[1]?.v, '1.00');
  assert.equal(row?.[2]?.v, '9007199254740993');
  assert.equal(row?.[3]?.v, 42);
});
