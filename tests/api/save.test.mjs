import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uid } from 'node:crypto';
import { freshDb, rpc, makeTree, expectError } from './helpers.mjs';

const save = (db, token, ops, base = 0, force = false, author = 'Расул') =>
  rpc(db, 'save_changes', token, author, base, ops, force);
const names = async (db, token) => (await rpc(db, 'open_tree', token)).people.map(p => p.name).sort();

// Магомед → Али → Расул; Магомед → Патимат
async function family(db) {
  const t = await makeTree(db);
  const ali = uid(), rasul = uid(), patimat = uid();
  const r = await save(db, t.e, [
    { type: 'add_child', id: ali, parent_id: t.rootId, name: 'Али', spouse: '' },
    { type: 'add_child', id: rasul, parent_id: ali, name: 'Расул', spouse: '' },
    { type: 'add_child', id: patimat, parent_id: t.rootId, name: 'Патимат', spouse: '' },
  ]);
  return { ...t, ali, rasul, patimat, version: Number(r.version) };
}

test('view cannot save', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  await expectError(save(db, t.v, [{ type: 'update', person_id: t.rootId, name: 'Мага' }]), 'forbidden');
});

test('batch applies atomically', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const ali = uid(), rasul = uid(), patimat = uid();
  const ops = [
    { type: 'add_child', id: ali, parent_id: t.rootId, name: 'Али', spouse: '' },
    { type: 'add_child', id: rasul, parent_id: ali, name: 'Расул', spouse: '' },
    { type: 'update', person_id: t.rootId, spouse: 'жена Асият' },
    { type: 'add_child', id: patimat, parent_id: t.rootId, name: 'Патимат', spouse: '' },
    { type: 'marry', id: uid(), a_id: ali, b_id: patimat },
  ];
  const r = await save(db, t.e, ops);
  assert.equal(r.ok, true);
  assert.equal(Number(r.version), 1);
  const o = await rpc(db, 'open_tree', t.o);
  assert.equal(o.people.length, 4);
  assert.equal(o.people.find(p => p.id === t.rootId).spouse, 'жена Асият');
  assert.equal(o.marriages.length, 1);

  const t2 = await makeTree(db);
  await expectError(save(db, t2.e, [
    { type: 'add_child', id: uid(), parent_id: t2.rootId, name: 'Али', spouse: '' },
    { type: 'update', person_id: uid(), name: 'Никто' },
  ]), 'bad_op');
  const o2 = await rpc(db, 'open_tree', t2.o);
  assert.equal(Number(o2.version), 0);
  assert.equal(o2.people.length, 1);
});

test('delete branch', async () => {
  const db = await freshDb();
  const f = await family(db);
  await save(db, f.e, [{ type: 'delete', person_id: f.ali }], f.version);
  assert.deepEqual(await names(db, f.o), ['Магомед', 'Патимат']);
});

test('root_protected', async () => {
  const db = await freshDb();
  const f = await family(db);
  await expectError(save(db, f.e, [{ type: 'delete', person_id: f.rootId }], f.version), 'root_protected');
  await expectError(save(db, f.e, [{ type: 'move', person_id: f.rootId, parent_id: f.ali }], f.version), 'root_protected');
});

test('cycle', async () => {
  const db = await freshDb();
  const f = await family(db);
  await expectError(save(db, f.e, [{ type: 'move', person_id: f.ali, parent_id: f.rasul }], f.version), 'cycle');
  const r = await save(db, f.e, [{ type: 'move', person_id: f.rasul, parent_id: f.patimat }], f.version);
  assert.equal(r.ok, true);
  const o = await rpc(db, 'open_tree', f.o);
  assert.equal(o.people.find(p => p.id === f.rasul).parent_id, f.patimat);
});

test('add_parent', async () => {
  const db = await freshDb();
  const f = await family(db);
  const hasan = uid();
  await save(db, f.e, [{ type: 'add_parent', id: hasan, child_id: f.rootId, name: 'Хасан', spouse: '' }], f.version);
  const o = await rpc(db, 'open_tree', f.o);
  assert.equal(o.root_id, hasan);
  assert.equal(o.people.find(p => p.id === f.rootId).parent_id, hasan);
  await expectError(save(db, f.e, [{ type: 'add_parent', id: uid(), child_id: f.ali, name: 'Х', spouse: '' }], 2), 'not_root');
});

test('conflict changed', async () => {
  const db = await freshDb();
  const f = await family(db);
  await save(db, f.e, [{ type: 'update', person_id: f.ali, name: 'Алий' }], f.version, false, 'Зайнаб');
  const mine = [{ type: 'update', person_id: f.ali, spouse: 'жена Асият' }];
  const r = await save(db, f.e, mine, f.version);
  assert.equal(r.ok, false);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].person_id, f.ali);
  assert.equal(r.conflicts[0].reason, 'changed');
  assert.equal(r.conflicts[0].by, 'Зайнаб');
  const forced = await save(db, f.e, mine, f.version, true);
  assert.equal(forced.ok, true);
});

test('concurrent children of one parent do not conflict', async () => {
  const db = await freshDb();
  const f = await family(db);
  await save(db, f.e, [{ type: 'add_child', id: uid(), parent_id: f.ali, name: 'Муса', spouse: '' }], f.version);
  const r = await save(db, f.e, [{ type: 'add_child', id: uid(), parent_id: f.ali, name: 'Иса', spouse: '' }], f.version);
  assert.equal(r.ok, true);
});

test('ops on deleted person conflict', async () => {
  const db = await freshDb();
  const f = await family(db);
  await save(db, f.e, [{ type: 'delete', person_id: f.ali }], f.version, false, 'Зайнаб');
  const mine = [{ type: 'add_child', id: uid(), parent_id: f.ali, name: 'Муса', spouse: '' }];
  const r = await save(db, f.e, mine, f.version);
  assert.equal(r.ok, false);
  assert.equal(r.conflicts[0].person_id, f.ali);
  assert.equal(r.conflicts[0].reason, 'deleted');
  await expectError(save(db, f.e, mine, f.version, true), 'bad_op');
});

test('name validation', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const id = uid();
  await save(db, t.e, [{ type: 'add_child', id, parent_id: t.rootId, name: '  Али  ', spouse: '' }]);
  assert.equal((await rpc(db, 'open_tree', t.o)).people.find(p => p.id === id).name, 'Али');
  for (const bad of ['   ', 'а'.repeat(101), 'Али\nРасул']) {
    await expectError(save(db, t.e, [{ type: 'add_child', id: uid(), parent_id: t.rootId, name: bad, spouse: '' }], 1), 'bad_name');
  }
});

test('author recorded', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  await save(db, t.e, [{ type: 'update', person_id: t.rootId, name: 'Мага' }], 0, false, 'Зайнаб');
  assert.equal((await rpc(db, 'open_tree', t.o)).people[0].updated_by, 'Зайнаб');
  await expectError(save(db, t.e, [{ type: 'update', person_id: t.rootId, name: 'Мага' }], 1, false, '  '), 'bad_name');
});

test('unknown op type and empty batch', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  await expectError(save(db, t.e, [{ type: 'drop_table' }]), 'bad_op');
  await expectError(save(db, t.e, []), 'bad_op');
});
