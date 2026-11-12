import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uid } from 'node:crypto';
import { freshDb, rpc, makeTree, expectError } from './helpers.mjs';

const save = (db, token, ops, base) => rpc(db, 'save_changes', token, 'Расул', base, ops, false);
const kids = async (db, token, parent) => (await rpc(db, 'open_tree', token)).people
  .filter(p => p.parent_id === parent).sort((a, b) => a.pos - b.pos).map(p => p.name);

async function family(db) {
  const t = await makeTree(db);
  const ids = { a: uid(), b: uid(), c: uid() };
  await save(db, t.e, [
    { type: 'add_child', id: ids.a, parent_id: t.rootId, name: 'Мухаммад', spouse: '' },
    { type: 'add_child', id: ids.b, parent_id: t.rootId, name: 'Загьра', spouse: '' },
    { type: 'add_child', id: ids.c, parent_id: t.rootId, name: 'Гайшат', spouse: '' },
  ], 0);
  return { ...t, ...ids };
}

test('reorder moves a child among siblings', async () => {
  const db = await freshDb();
  const f = await family(db);
  await save(db, f.e, [{ type: 'reorder', person_id: f.a, index: 2 }], 1);
  assert.deepEqual(await kids(db, f.o, f.rootId), ['Загьра', 'Гайшат', 'Мухаммад']);
  await save(db, f.e, [{ type: 'reorder', person_id: f.c, index: 0 }], 2);
  assert.deepEqual(await kids(db, f.o, f.rootId), ['Гайшат', 'Загьра', 'Мухаммад']);
});

test('reorder clamps the index and protects the root', async () => {
  const db = await freshDb();
  const f = await family(db);
  await save(db, f.e, [{ type: 'reorder', person_id: f.b, index: 99 }], 1);
  assert.deepEqual(await kids(db, f.o, f.rootId), ['Мухаммад', 'Гайшат', 'Загьра']);
  await expectError(save(db, f.e, [{ type: 'reorder', person_id: f.rootId, index: 0 }], 2), 'root_protected');
  await expectError(save(db, f.e, [{ type: 'reorder', person_id: f.a }], 2), 'bad_op');
});

test('reorder is reverted by the owner', async () => {
  const db = await freshDb();
  const f = await family(db);
  const s = await save(db, f.e, [{ type: 'reorder', person_id: f.a, index: 2 }], 1);
  await rpc(db, 'revert', f.o, 'Хозяин', s.save_id, null);
  assert.deepEqual(await kids(db, f.o, f.rootId), ['Мухаммад', 'Загьра', 'Гайшат']);
});
