import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, asAnon, rpc, setIp, h, tok, makeTree, expectError } from './helpers.mjs';

test('create and open', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  const o = await rpc(db, 'open_tree', t.o);
  assert.equal(o.role, 'owner');
  assert.equal((await rpc(db, 'open_tree', t.e)).role, 'edit');
  assert.equal((await rpc(db, 'open_tree', t.v)).role, 'view');
  assert.equal(o.people.length, 1);
  assert.equal(o.people[0].name, 'Магомед');
  assert.equal(o.root_id, t.rootId);
  assert.equal(Number(o.version), 0);
  assert.equal(o.title, 'Род Магомеда');
});

test('unknown token', async () => {
  const db = await freshDb();
  await expectError(rpc(db, 'open_tree', 'нет-такого'), 'tree_not_found');
});

test('tables closed', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  for (const table of ['trees', 'people', 'marriages', 'saves', 'edits', 'tree_creations']) {
    await expectError(asAnon(db, `select * from ${table}`), 'permission denied');
  }
  await expectError(asAnon(db, 'select * from drevo_private.role($1)', [t.o]), 'permission denied');
  const r = await asAnon(db, 'select open_tree($1) as v', [t.o]);
  assert.equal(r.rows[0].v.role, 'owner');
});

test('rate limit', async () => {
  const db = await freshDb();
  await setIp(db, '1.2.3.4');
  for (let i = 0; i < 5; i++) await makeTree(db);
  await expectError(makeTree(db), 'too_many_trees');
  await setIp(db, '5.6.7.8');
  await makeTree(db);
});

test('root name validation', async () => {
  const db = await freshDb();
  await expectError(rpc(db, 'create_tree', 'Род', '   ', h(tok()), h(tok()), h(tok())), 'bad_name');
});

test('tree_version and ping', async () => {
  const db = await freshDb();
  const t = await makeTree(db);
  assert.equal(Number(await rpc(db, 'tree_version', t.v)), 0);
  assert.equal(await rpc(db, 'ping'), 1);
});
