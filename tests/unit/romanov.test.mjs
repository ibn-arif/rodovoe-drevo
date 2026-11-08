import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateName } from '../../js/names.js';

const data = JSON.parse(readFileSync(new URL('../../data/romanov.json', import.meta.url), 'utf8'));
const all = [];
(function walk(n) { all.push(n); (n.c || []).forEach(walk); })(data.root);

test('romanov example data', () => {
  assert.equal(data.root.n, 'Михаил Фёдорович (1596–1645)');
  for (const who of ['Пётр I', 'Николай II', 'Алексей Николаевич']) {
    assert.ok(all.some(p => p.n.startsWith(who + ' (')), who);
  }
  assert.ok(all.length >= 100 && all.length <= 300, String(all.length));
  for (const p of all) {
    assert.equal(validateName(p.n).ok, true, p.n);
    if (p.sp) assert.equal(validateName(p.sp).ok, true, p.sp);
  }
});

test('example.sql builds a view-only example tree', async () => {
  const { buildExampleSql } = await import('../../scripts/build-example.mjs');
  const { freshDb, rpc } = await import('../sql/helpers.mjs');
  const { sql, ownerToken } = buildExampleSql(data, 'test-owner-token-123456');
  assert.equal(ownerToken, 'test-owner-token-123456');
  assert.ok(!sql.includes('test-owner-token-123456'), 'owner token must not be in the SQL');
  const db = await freshDb();
  await db.exec(sql);
  const t = await rpc(db, 'open_tree', 'romanovy');
  assert.equal(t.role, 'view');
  assert.equal(t.is_example, true);
  assert.equal(t.title, 'Романовы');
  assert.equal(t.people.length, all.length);
  // Повторное применение не создаёт второе древо.
  await db.exec(sql);
  assert.equal((await rpc(db, 'open_tree', 'romanovy')).people.length, all.length);
});
