import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft } from '../../js/draft.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const op = n => ({ type: 'update', person_id: 'p' + n, name: 'Имя' + n });

test('draft survives re-creation with the same storage', () => {
  const st = memoryStorage();
  const d = createDraft('tree1', st);
  d.setBase(7);
  d.add(op(1));
  d.add(op(2));
  const again = createDraft('tree1', st);
  assert.deepEqual(again.ops, [op(1), op(2)]);
  assert.equal(again.baseVersion, 7);
  assert.equal(again.persistent, true);
  assert.equal(createDraft('tree2', st).ops.length, 0);
});

test('remove drops only the given op; clear empties', () => {
  const d = createDraft('t', memoryStorage());
  [1, 2, 3].forEach(n => d.add(op(n)));
  d.remove(1);
  assert.deepEqual(d.ops, [op(1), op(3)]);
  d.clear();
  assert.deepEqual(d.ops, []);
});

test('onChange fires on every change', () => {
  const d = createDraft('t', memoryStorage());
  let n = 0;
  d.onChange(() => n++);
  d.add(op(1)); d.remove(0); d.setBase(3); d.clear();
  assert.equal(n, 4);
});

test('draft without storage', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  const d = createDraft('t', broken);
  assert.equal(d.persistent, false);
  d.add(op(1));
  assert.equal(d.ops.length, 1);
  const none = createDraft('t', null);
  assert.equal(none.persistent, false);
  none.add(op(1));
  assert.equal(none.ops.length, 1);
});
