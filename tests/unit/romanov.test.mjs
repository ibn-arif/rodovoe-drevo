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
