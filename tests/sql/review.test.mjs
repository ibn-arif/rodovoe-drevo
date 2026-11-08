// Находки финальной проверки: каждый тест воспроизводит дефект.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uid } from 'node:crypto';
import { freshDb, rpc, makeTree, expectError, h, tok, setIp, asAnon } from './helpers.mjs';

const save = (db, token, ops, base, author = 'Расул', force = false) => rpc(db, 'save_changes', token, author, base, ops, force);
const revert = (db, token, saveId, editId = null) => rpc(db, 'revert', token, 'Хозяин', saveId, editId);
const open = (db, token) => rpc(db, 'open_tree', token);

test('C1: a new tree cannot reuse another tree\'s token hash', async () => {
  const db = await freshDb();
  const victim = await makeTree(db, 'Магомед', 'Род Магомеда');
  for (const stolen of [victim.v, victim.e, victim.o]) {
    await expectError(rpc(db, 'create_tree', 'Чужое', 'Злодей', h(stolen), h(tok()), h(tok())), 'bad_token');
    await expectError(rpc(db, 'create_tree', 'Чужое', 'Злодей', h(tok()), h(stolen), h(tok())), 'bad_token');
    await expectError(rpc(db, 'create_tree', 'Чужое', 'Злодей', h(tok()), h(tok()), h(stolen)), 'bad_token');
  }
  await save(db, victim.e, [{ type: 'update', person_id: victim.rootId, spouse: 'жена Асият' }], 0);
  const o = await open(db, victim.v);
  assert.equal(o.title, 'Род Магомеда');
  assert.equal(o.role, 'view');
});

test('C2: reverting a move that would create a cycle is refused', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const p = uid(), a = uid(), b = uid();
  await save(db, t.e, [
    { type: 'add_child', id: p, parent_id: t.rootId, name: 'П', spouse: '' },
    { type: 'add_child', id: a, parent_id: p, name: 'А', spouse: '' },
    { type: 'add_child', id: b, parent_id: t.rootId, name: 'Б', spouse: '' },
  ], 0);
  const s1 = await save(db, t.e, [{ type: 'move', person_id: a, parent_id: b }], 1);
  await save(db, t.e, [{ type: 'move', person_id: p, parent_id: a }], 2);
  await expectError(revert(db, t.o, s1.save_id), 'cannot_revert');
  assert.equal((await open(db, t.o)).people.length, 4);
});

test('I1a: reverting a delete whose parent is now deleted is refused', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const p = uid(), x = uid();
  await save(db, t.e, [
    { type: 'add_child', id: p, parent_id: t.rootId, name: 'П', spouse: '' },
    { type: 'add_child', id: x, parent_id: p, name: 'Икс', spouse: '' },
  ], 0);
  const s1 = await save(db, t.e, [{ type: 'delete', person_id: x }], 1);
  await save(db, t.e, [{ type: 'delete', person_id: p }], 2);
  await expectError(revert(db, t.o, s1.save_id), 'cannot_revert');
});

test('I1b: reverting add_parent after the ancestor got another child is refused', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const n = uid();
  const s1 = await save(db, t.e, [{ type: 'add_parent', id: n, child_id: t.rootId, name: 'Предок', spouse: '' }], 0);
  await save(db, t.e, [{ type: 'add_child', id: uid(), parent_id: n, name: 'Брат', spouse: '' }], 1);
  await expectError(revert(db, t.o, s1.save_id), 'cannot_revert');
});

test('I1c: reverting add_parent after the old root was deleted is refused', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const n = uid();
  const s1 = await save(db, t.e, [{ type: 'add_parent', id: n, child_id: t.rootId, name: 'Предок', spouse: '' }], 0);
  await save(db, t.e, [{ type: 'delete', person_id: t.rootId }], 1);
  await expectError(revert(db, t.o, s1.save_id), 'cannot_revert');
  const o = await open(db, t.o);
  assert.ok(o.people.some(p => p.id === o.root_id));
});

test('I2: unknown op fields are not stored', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  await save(db, t.e, [{ type: 'update', person_id: t.rootId, name: 'Мага', junk: 'x'.repeat(5000) }], 0);
  const hist = await rpc(db, 'get_history', t.e, 50, null);
  assert.equal(hist[0].edits[0].op.junk, undefined);
  assert.equal(hist[0].edits[0].op.name, 'Мага');
});

test('I2: oversized payload is refused', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const ops = Array.from({ length: 4000 }, () => ({ type: 'add_child', id: uid(), parent_id: t.rootId, name: 'Имя', spouse: 'жена Асият', pad: 'x'.repeat(300) }));
  await expectError(save(db, t.e, ops, 0), 'too_large');
});

test('I2: saves per tree are rate limited', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  let v = 0, err = null;
  for (let i = 0; i < 130 && !err; i++) {
    try { v = Number((await save(db, t.e, [{ type: 'update', person_id: t.rootId, name: 'Мага' + i }], v)).version); }
    catch (e) { err = e; }
  }
  assert.ok(err && err.message.includes('too_many_saves'), String(err?.message));
});

test('I3: client ip prefers cf-connecting-ip and ignores a forged first x-forwarded-for', async () => {
  const db = await freshDb();
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4', 'cf-connecting-ip': '1.2.3.4' })]);
  for (let i = 0; i < 5; i++) await makeTree(db);
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': '7.7.7.7, 1.2.3.4', 'cf-connecting-ip': '1.2.3.4' })]);
  await expectError(makeTree(db), 'too_many_trees');
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': '9.9.9.9, 5.5.5.5' })]);
  for (let i = 0; i < 5; i++) await makeTree(db);
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': '8.8.8.8, 5.5.5.5' })]);
  await expectError(makeTree(db), 'too_many_trees');
});

test('I4: unmarry of an already removed marriage is a conflict, not bad_op', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const a = uid(), b = uid(), m = uid();
  await save(db, t.e, [
    { type: 'add_child', id: a, parent_id: t.rootId, name: 'Али', spouse: '' },
    { type: 'add_child', id: b, parent_id: t.rootId, name: 'Патимат', spouse: '' },
    { type: 'marry', id: m, a_id: a, b_id: b },
  ], 0);
  await save(db, t.e, [{ type: 'unmarry', marriage_id: m }], 1, 'Зайнаб');
  const r = await save(db, t.e, [{ type: 'unmarry', marriage_id: m }], 1);
  assert.equal(r.ok, false);
  assert.equal(r.conflicts[0].by, 'Зайнаб');
});

test('invisible or control-character names are rejected', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  for (const bad of [' ​', 'Али\u000b', 'Али Расул', '​​']) {
    await expectError(save(db, t.e, [{ type: 'add_child', id: uid(), parent_id: t.rootId, name: bad, spouse: '' }], 0), 'bad_name');
  }
  await save(db, t.e, [{ type: 'add_child', id: uid(), parent_id: t.rootId, name: ' Али ', spouse: '' }], 0);
  assert.ok((await open(db, t.o)).people.some(p => p.name === 'Али'));
});

test('marriages with a deleted spouse are not returned', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const a = uid(), b = uid();
  await save(db, t.e, [
    { type: 'add_child', id: a, parent_id: t.rootId, name: 'Али', spouse: '' },
    { type: 'add_child', id: b, parent_id: t.rootId, name: 'Патимат', spouse: '' },
    { type: 'marry', id: uid(), a_id: a, b_id: b },
  ], 0);
  await save(db, t.e, [{ type: 'delete', person_id: b }], 1);
  assert.equal((await open(db, t.o)).marriages.length, 0);
});
