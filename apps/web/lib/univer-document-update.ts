import { JSONX, type createUniver } from '@univerjs/presets';
import type { OfficeContent } from './office-content';

/** Publish a remote snapshot through Univer's collaboration mutation. The unit,
 * canvas, scroll container and local undo history all remain mounted.
 */
export function updateUniverDocument(api: Pick<ReturnType<typeof createUniver>['univerAPI'], 'getActiveDocument' | 'syncExecuteCommand'>, next: OfficeContent): boolean {
  const doc = api.getActiveDocument();
  if (!doc || next.kind !== 'DOCUMENT' || next.snapshot.id !== doc.id) return false;
  const previous = doc.save();
  const json = JSONX.getInstance();
  let actions: ReturnType<typeof json.replaceOp> | undefined;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next.snapshot)]);
  for (const key of keys) {
    if (key === 'id' || key === 'resources') continue;
    const before = previous[key as keyof typeof previous];
    const after = next.snapshot[key as keyof typeof next.snapshot];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const action = after === undefined ? json.removeOp([key], before) : before === undefined ? json.insertOp([key], after) : json.replaceOp([key], before, structuredClone(after));
    actions = actions === undefined ? action : JSONX.compose(actions, action);
  }
  if (actions !== undefined) api.syncExecuteCommand('doc.mutation.rich-text-editing', {
    unitId: doc.id, actions, textRanges: null, noNeedSetTextRange: true, noHistory: true, isEditing: false,
  }, { fromCollab: true });
  const applied = doc.save();
  return [...keys].filter((key) => key !== 'id' && key !== 'resources').every((key) => JSON.stringify(applied[key as keyof typeof applied]) === JSON.stringify(next.snapshot[key as keyof typeof next.snapshot]));
}
