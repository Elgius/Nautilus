import { expect, test } from 'bun:test'
import { createSnapshotReader } from '../src/agent_interface/read-snapshots'

test('concurrent reads coalesce and remain pinned when a writer advances the document', async () => {
  let version = 'v1', loads = 0
  const read = createSnapshotReader(async (id: string) => { loads++; return { id, currentVersionId: version, content: version } })
  const [first, second] = await Promise.all([read('doc'), read('doc')])
  version = 'v2'
  expect(await read('doc')).toBe(first)
  expect(second).toBe(first)
  expect(first.currentVersionId).toBe('v1')
  expect(loads).toBe(1)
  expect((await read('another')).currentVersionId).toBe('v2')
})

test('failed loads may retry, while successful snapshots are never evicted to satisfy limits', async () => {
  let fail = true
  const read = createSnapshotReader(async (id: string) => { if (fail) throw new Error('Unavailable'); return id })
  await expect(read('doc')).rejects.toThrow('Unavailable')
  fail = false
  expect(await read('doc')).toBe('doc')
  for (let i = 0; i < 9; i++) await read(String(i))
  expect(() => read('overflow')).toThrow('ten documents')
  expect(await read('doc')).toBe('doc')
})

test('snapshot budgets count encoded bytes and reject excessive retained content', async () => {
  const read = createSnapshotReader(async () => '漢'.repeat(1_400_000))
  await read('first')
  await expect(read('second')).rejects.toThrow('memory budget')
  expect((await read('first')).length).toBe(1_400_000)
})
