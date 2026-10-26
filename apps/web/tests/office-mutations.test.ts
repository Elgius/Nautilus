import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belongsToOfficeUnit } from '../lib/office-mutations';

test('spreadsheet cell editor startup does not mark the room workbook dirty', () => {
  assert.equal(belongsToOfficeUnit({ unitId: '__INTERNAL_EDITOR__DOCS_NORMAL', trigger: 'doc.command-replace-snapshot' }, 'workbook'), false);
  assert.equal(belongsToOfficeUnit({ unitId: '__INTERNAL_EDITOR__DOCS_FORMULA_BAR' }, 'workbook'), false);
});
test('real document/workbook mutations and unitless resource changes remain observable', () => {
  assert.equal(belongsToOfficeUnit({ unitId: 'workbook', subUnitId: 'sheet-1' }, 'workbook'), true);
  assert.equal(belongsToOfficeUnit({ unitId: 'document' }, 'document'), true);
  assert.equal(belongsToOfficeUnit({ unitId: 'other-document' }, 'document'), false);
  assert.equal(belongsToOfficeUnit({}, 'document'), true);
  assert.equal(belongsToOfficeUnit(undefined, 'document'), true);
});
