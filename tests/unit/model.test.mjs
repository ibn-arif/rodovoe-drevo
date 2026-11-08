import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyOps, describeOp, describeOps, countBranch } from '../../js/model.js';

const P = (id, parent_id, pos, name, spouse = '') => ({ id, parent_id, pos, name, spouse, updated_by: '', updated_at: '' });
// root → ali(→ rasul → musa), patimat
const snap = () => ({
  root_id: 'root',
  people: [P('root', null, 0, 'Магомед'), P('pat', 'root', 1, 'Патимат'), P('ali', 'root', 0, 'Али'),
           P('ras', 'ali', 0, 'Расул'), P('musa', 'ras', 0, 'Муса')],
  marriages: [],
});
const names = s => s.people.map(p => p.name).sort();
const throwsCode = (fn, code) => assert.throws(fn, e => e.message === code);

test('buildTree orders children by pos', () => {
  const t = buildTree(snap());
  assert.equal(t.name, 'Магомед');
  assert.deepEqual(t.children.map(c => c.name), ['Али', 'Патимат']);
  assert.equal(t.children[0].children[0].children[0].name, 'Муса');
});

test('applyOps does not mutate input', () => {
  const s = snap();
  const copy = JSON.stringify(s);
  applyOps(s, [{ type: 'delete', person_id: 'ali' }]);
  assert.equal(JSON.stringify(s), copy);
});

test('delete branch', () => {
  const s = applyOps(snap(), [{ type: 'delete', person_id: 'ali' }]);
  assert.deepEqual(names(s), ['Магомед', 'Патимат']);
  throwsCode(() => applyOps(snap(), [{ type: 'delete', person_id: 'root' }]), 'root_protected');
});

test('cycle and move', () => {
  throwsCode(() => applyOps(snap(), [{ type: 'move', person_id: 'ali', parent_id: 'musa' }]), 'cycle');
  throwsCode(() => applyOps(snap(), [{ type: 'move', person_id: 'root', parent_id: 'ali' }]), 'root_protected');
  const s = applyOps(snap(), [{ type: 'move', person_id: 'ras', parent_id: 'pat' }]);
  const ras = s.people.find(p => p.id === 'ras');
  assert.equal(ras.parent_id, 'pat');
  assert.equal(ras.draft, 'moved');
});

test('add_parent and add_child', () => {
  const s = applyOps(snap(), [
    { type: 'add_parent', id: 'has', child_id: 'root', name: 'Хасан', spouse: '' },
    { type: 'add_child', id: 'isa', parent_id: 'pat', name: '  Иса ', spouse: 'жена Асият' },
  ]);
  assert.equal(s.root_id, 'has');
  assert.equal(s.people.find(p => p.id === 'root').parent_id, 'has');
  const isa = s.people.find(p => p.id === 'isa');
  assert.equal(isa.name, 'Иса');
  assert.equal(isa.draft, 'added');
  throwsCode(() => applyOps(snap(), [{ type: 'add_parent', id: 'x', child_id: 'ali', name: 'Х', spouse: '' }]), 'not_root');
  throwsCode(() => applyOps(snap(), [{ type: 'add_child', id: 'x', parent_id: 'nobody', name: 'Х', spouse: '' }]), 'bad_op');
  throwsCode(() => applyOps(snap(), [{ type: 'add_child', id: 'x', parent_id: 'pat', name: ' ', spouse: '' }]), 'bad_name');
});

test('update, marry, unmarry', () => {
  const s = applyOps(snap(), [
    { type: 'update', person_id: 'ali', spouse: 'жена Асият' },
    { type: 'marry', id: 'm1', a_id: 'ras', b_id: 'pat' },
  ]);
  const ali = s.people.find(p => p.id === 'ali');
  assert.equal(ali.name, 'Али');
  assert.equal(ali.spouse, 'жена Асият');
  assert.equal(ali.draft, 'changed');
  assert.equal(s.marriages.length, 1);
  const s2 = applyOps(s, [{ type: 'unmarry', marriage_id: 'm1' }]);
  assert.equal(s2.marriages.length, 0);
});

test('describeOp templates', () => {
  const s = snap();
  assert.equal(describeOp({ type: 'add_child', id: 'x', parent_id: 'root', name: 'Али', spouse: '' }, s), 'Добавлен ребёнок: Али (родитель — Магомед)');
  assert.equal(describeOp({ type: 'add_parent', id: 'x', child_id: 'root', name: 'Хасан', spouse: '' }, s), 'Добавлен предок: Хасан (ребёнок — Магомед)');
  assert.equal(describeOp({ type: 'update', person_id: 'ali', name: 'Алий' }, s), 'Исправлено имя: Али → Алий');
  assert.equal(describeOp({ type: 'update', person_id: 'ali', spouse: 'жена Асият' }, s), 'Подпись о супруге у Али: жена Асият');
  assert.equal(describeOp({ type: 'move', person_id: 'ali', parent_id: 'ras' }, s), 'Перенесён: Али (новый родитель — Расул)');
  assert.equal(describeOp({ type: 'delete', person_id: 'ali' }, s), 'Удалена ветка: Али — 3 чел.');
  assert.equal(describeOp({ type: 'delete', person_id: 'pat' }, s), 'Удалён: Патимат');
  assert.equal(describeOp({ type: 'marry', id: 'm', a_id: 'ali', b_id: 'pat' }, s), 'Брак: Али и Патимат');
  const sm = { ...s, marriages: [{ id: 'm', a_id: 'ali', b_id: 'pat' }] };
  assert.equal(describeOp({ type: 'unmarry', marriage_id: 'm' }, sm), 'Убран брак: Али и Патимат');
});

test('describeOps describes each op against the state before it', () => {
  const d = describeOps(snap(), [
    { type: 'add_child', id: 'isa', parent_id: 'pat', name: 'Иса', spouse: '' },
    { type: 'update', person_id: 'isa', name: 'Иисус' },
  ]);
  assert.deepEqual(d, ['Добавлен ребёнок: Иса (родитель — Патимат)', 'Исправлено имя: Иса → Иисус']);
});

test('countBranch', () => {
  assert.equal(countBranch(snap(), 'ali'), 3);
  assert.equal(countBranch(snap(), 'pat'), 1);
});
