import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uid } from 'node:crypto';
import { freshDb, rpc, makeTree, expectError } from './helpers.mjs';

const save = (db, token, ops, base, author = 'Расул') => rpc(db, 'save_changes', token, author, base, ops, false);
const revert = (db, token, saveId, editId = null) => rpc(db, 'revert', token, 'Хозяин', saveId, editId);
const open = (db, token) => rpc(db, 'open_tree', token);
const shape = o => o.people.map(p => `${p.name}<${o.people.find(q => q.id === p.parent_id)?.name ?? ''}|${p.spouse}`).sort();

async function family(db) {
  const t = await makeTree(db);
  const ali = uid(), rasul = uid(), musa = uid(), patimat = uid();
  await save(db, t.e, [
    { type: 'add_child', id: ali, parent_id: t.rootId, name: 'Али', spouse: '' },
    { type: 'add_child', id: rasul, parent_id: ali, name: 'Расул', spouse: '' },
    { type: 'add_child', id: musa, parent_id: rasul, name: 'Муса', spouse: '' },
    { type: 'add_child', id: patimat, parent_id: t.rootId, name: 'Патимат', spouse: '' },
  ], 0);
  return { ...t, ali, rasul, musa, patimat };
}
const history = (db, token) => rpc(db, 'get_history', token, 50, null);

test('edit cannot revert', async () => {
  const db = await freshDb();
  const f = await family(db);
  const h = await history(db, f.e);
  assert.equal(h.length, 1);
  assert.equal(h[0].author, 'Расул');
  assert.equal(h[0].edits.length, 4);
  assert.deepEqual(h[0].edits[0].people, [f.ali]);
  await expectError(revert(db, f.e, h[0].save_id), 'forbidden');
  await expectError(history(db, f.v), 'forbidden');
});

test('revert delete restores branch', async () => {
  const db = await freshDb();
  const f = await family(db);
  const before = shape(await open(db, f.o));
  const s = await save(db, f.e, [{ type: 'delete', person_id: f.ali }], 1);
  const del = await rpc(db, 'deleted_items', f.o);
  assert.equal(del.length, 1);
  assert.equal(del[0].name, 'Али');
  assert.equal(del[0].count, 3);
  assert.equal(del[0].by, 'Расул');
  await expectError(rpc(db, 'deleted_items', f.e), 'forbidden');
  const r = await revert(db, f.o, s.save_id, del[0].edit_id);
  assert.equal(r.ok, true);
  assert.deepEqual(shape(await open(db, f.o)), before);
  assert.equal((await rpc(db, 'deleted_items', f.o)).length, 0);
});

test('revert keeps people deleted earlier by another edit', async () => {
  const db = await freshDb();
  const f = await family(db);
  await save(db, f.e, [{ type: 'delete', person_id: f.musa }], 1);
  const s = await save(db, f.e, [{ type: 'delete', person_id: f.ali }], 2);
  await revert(db, f.o, s.save_id);
  const names = (await open(db, f.o)).people.map(p => p.name);
  assert.ok(names.includes('Расул'));
  assert.ok(!names.includes('Муса'));
});

test('revert whole save', async () => {
  const db = await freshDb();
  const f = await family(db);
  const before = shape(await open(db, f.o));
  const s = await save(db, f.e, [
    { type: 'update', person_id: f.ali, name: 'Алий', spouse: 'жена Асият' },
    { type: 'move', person_id: f.rasul, parent_id: f.patimat },
    { type: 'add_child', id: uid(), parent_id: f.patimat, name: 'Иса', spouse: '' },
    { type: 'marry', id: uid(), a_id: f.ali, b_id: f.patimat },
  ], 1);
  const r = await revert(db, f.o, s.save_id);
  assert.equal(r.ok, true);
  const o = await open(db, f.o);
  assert.deepEqual(shape(o), before);
  assert.equal(o.marriages.length, 0);
});

test('revert single edit', async () => {
  const db = await freshDb();
  const f = await family(db);
  const s = await save(db, f.e, [
    { type: 'update', person_id: f.ali, name: 'Алий' },
    { type: 'add_child', id: uid(), parent_id: f.patimat, name: 'Иса', spouse: '' },
    { type: 'update', person_id: f.patimat, spouse: 'муж Ахмед' },
  ], 1);
  const h = await history(db, f.o);
  const upd = h[0].edits.find(e => e.op.type === 'update' && e.op.name === 'Алий');
  await revert(db, f.o, s.save_id, upd.edit_id);
  const o = await open(db, f.o);
  const names = o.people.map(p => p.name);
  assert.ok(names.includes('Али') && !names.includes('Алий'));
  assert.ok(names.includes('Иса'));
  assert.equal(o.people.find(p => p.id === f.patimat).spouse, 'муж Ахмед');
});

test('revert add_parent', async () => {
  const db = await freshDb();
  const f = await family(db);
  const s = await save(db, f.e, [{ type: 'add_parent', id: uid(), child_id: f.rootId, name: 'Хасан', spouse: '' }], 1);
  await revert(db, f.o, s.save_id);
  const o = await open(db, f.o);
  assert.equal(o.root_id, f.rootId);
  assert.equal(o.people.find(p => p.id === f.rootId).parent_id, null);
  assert.ok(!o.people.some(p => p.name === 'Хасан'));
});

test('revert unmarry', async () => {
  const db = await freshDb();
  const f = await family(db);
  const m = uid();
  await save(db, f.e, [{ type: 'marry', id: m, a_id: f.ali, b_id: f.patimat }], 1);
  const s = await save(db, f.e, [{ type: 'unmarry', marriage_id: m }], 2);
  await revert(db, f.o, s.save_id);
  assert.equal((await open(db, f.o)).marriages.length, 1);
});

test('warnings', async () => {
  const db = await freshDb();
  const f = await family(db);
  const s1 = await save(db, f.e, [{ type: 'update', person_id: f.ali, name: 'Алий' }], 1);
  await save(db, f.e, [{ type: 'update', person_id: f.ali, spouse: 'жена Асият' }], 2, 'Зайнаб');
  const r = await revert(db, f.o, s1.save_id);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].person_id, f.ali);
  assert.equal(r.warnings[0].by, 'Зайнаб');
  const o = await open(db, f.o);
  const ali = o.people.find(p => p.id === f.ali);
  assert.equal(ali.name, 'Али');
  assert.equal(ali.spouse, 'жена Асият');
});

test('revert is history', async () => {
  const db = await freshDb();
  const f = await family(db);
  const s = await save(db, f.e, [{ type: 'update', person_id: f.ali, name: 'Алий' }], 1);
  const r = await revert(db, f.o, s.save_id);
  const h = await history(db, f.o);
  assert.equal(h[0].save_id, r.save_id);
  assert.equal(h[0].reverts_save, s.save_id);
  assert.equal(h[0].author, 'Хозяин');
  const orig = h.find(x => x.save_id === s.save_id);
  assert.equal(orig.reverted_by, r.save_id);
  assert.equal(orig.edits[0].reverted_by, r.save_id);
  assert.equal(Number((await open(db, f.o)).version), 3);
});

test('already_reverted', async () => {
  const db = await freshDb();
  const f = await family(db);
  const s = await save(db, f.e, [{ type: 'update', person_id: f.ali, name: 'Алий' }], 1);
  await revert(db, f.o, s.save_id);
  await expectError(revert(db, f.o, s.save_id), 'already_reverted');
});

test('history paging', async () => {
  const db = await freshDb();
  const f = await family(db);
  for (let i = 0; i < 3; i++) await save(db, f.e, [{ type: 'update', person_id: f.ali, name: 'Али' + i }], 1 + i);
  const page1 = await rpc(db, 'get_history', f.e, 2, null);
  assert.equal(page1.length, 2);
  const page2 = await rpc(db, 'get_history', f.e, 2, page1[1].save_id);
  assert.equal(page2.length, 2);
  assert.ok(page2[0].save_id < page1[1].save_id);
});
