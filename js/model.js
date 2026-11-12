// Модель древа: снимок из базы → дерево; черновик правок поверх снимка; описание правок.
// Правила applyOps повторяют функции базы (supabase/schema.sql), коды ошибок те же.
import { validateName } from './names.js';

const fail = code => { throw new Error(code); };

function cleanName(s) {
  const r = validateName(s);
  if (!r.ok) fail('bad_name');
  return r.value;
}
function cleanSpouse(s) {
  return String(s ?? '').trim() === '' ? '' : cleanName(s);
}

export function buildTree(snapshot) {
  const byId = new Map(snapshot.people.map(p => [p.id, { ...p, children: [] }]));
  for (const n of byId.values()) {
    const parent = n.parent_id && byId.get(n.parent_id);
    if (parent) parent.children.push(n);
  }
  for (const n of byId.values()) n.children.sort((a, b) => a.pos - b.pos);
  return byId.get(snapshot.root_id) ?? null;
}

function descendants(people, id) {
  const out = [id], seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const p of people) if (p.parent_id === out[i] && !seen.has(p.id)) { seen.add(p.id); out.push(p.id); }
  }
  return out;
}

export function countBranch(snapshot, personId) {
  return descendants(snapshot.people, personId).length;
}

const nextPos = (people, parentId) =>
  people.filter(p => p.parent_id === parentId).reduce((m, p) => Math.max(m, p.pos + 1), 0);

// Применяет правки к копии снимка. Затронутые люди получают draft: added | changed | moved.
export function applyOps(snapshot, ops) {
  const s = {
    ...snapshot,
    people: snapshot.people.map(p => ({ ...p })),
    marriages: snapshot.marriages.map(m => ({ ...m })),
  };
  const find = id => s.people.find(p => p.id === id) ?? fail('bad_op');
  const isNew = id => !id || s.people.some(p => p.id === id) ? fail('bad_op') : id;

  for (const op of ops) {
    switch (op.type) {
      case 'add_child': {
        const parent = find(op.parent_id);
        s.people.push({ id: isNew(op.id), parent_id: parent.id, pos: nextPos(s.people, parent.id),
          name: cleanName(op.name), spouse: cleanSpouse(op.spouse), updated_by: '', updated_at: '', draft: 'added' });
        break;
      }
      case 'add_parent': {
        const child = find(op.child_id);
        if (child.id !== s.root_id) fail('not_root');
        s.people.push({ id: isNew(op.id), parent_id: null, pos: 0, name: cleanName(op.name),
          spouse: cleanSpouse(op.spouse), updated_by: '', updated_at: '', draft: 'added' });
        child.parent_id = op.id;
        child.pos = 0;
        child.draft ??= 'moved';
        s.root_id = op.id;
        break;
      }
      case 'update': {
        const p = find(op.person_id);
        if (!('name' in op) && !('spouse' in op)) fail('bad_op');
        if ('name' in op) p.name = cleanName(op.name);
        if ('spouse' in op) p.spouse = cleanSpouse(op.spouse);
        if (p.draft !== 'added') p.draft = 'changed';
        break;
      }
      case 'move': {
        const p = find(op.person_id);
        if (p.id === s.root_id) fail('root_protected');
        const parent = find(op.parent_id);
        if (descendants(s.people, p.id).includes(parent.id)) fail('cycle');
        p.parent_id = parent.id;
        p.pos = nextPos(s.people, parent.id);
        if (p.draft !== 'added') p.draft = 'moved';
        break;
      }
      case 'delete': {
        const p = find(op.person_id);
        if (p.id === s.root_id) fail('root_protected');
        const gone = new Set(descendants(s.people, p.id));
        s.people = s.people.filter(q => !gone.has(q.id));
        s.marriages = s.marriages.filter(m => !gone.has(m.a_id) && !gone.has(m.b_id));
        break;
      }
      case 'reorder': {
        // Сдвинуть среди братьев и сестёр: порядок = старшинство (как в базе).
        const p = find(op.person_id);
        if (p.id === s.root_id) fail('root_protected');
        if (typeof op.index !== 'number') fail('bad_op');
        const sib = s.people.filter(q => q.parent_id === p.parent_id && q.id !== p.id)
          .sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : 1));
        const k = Math.max(0, Math.min(Math.trunc(op.index), sib.length));
        sib.splice(k, 0, p);
        sib.forEach((q, i) => { q.pos = i; });
        if (p.draft !== 'added') p.draft = 'changed';
        break;
      }
      case 'marry': {
        const a = find(op.a_id), b = find(op.b_id);
        if (a.id === b.id || s.marriages.some(m => m.id === op.id ||
            (m.a_id === a.id && m.b_id === b.id) || (m.a_id === b.id && m.b_id === a.id))) fail('bad_op');
        s.marriages.push({ id: op.id, a_id: a.id, b_id: b.id, draft: 'added' });
        break;
      }
      case 'unmarry': {
        if (!s.marriages.some(m => m.id === op.marriage_id)) fail('bad_op');
        s.marriages = s.marriages.filter(m => m.id !== op.marriage_id);
        break;
      }
      default:
        fail('bad_op');
    }
  }
  return s;
}

export function describeOp(op, snapshot) {
  const name = id => snapshot.people.find(p => p.id === id)?.name ?? '?';
  switch (op.type) {
    case 'add_child': return `Добавлен ребёнок: ${String(op.name).trim()} (родитель — ${name(op.parent_id)})`;
    case 'add_parent': return `Добавлен предок: ${String(op.name).trim()} (ребёнок — ${name(op.child_id)})`;
    case 'update': {
      const parts = [];
      if ('name' in op) parts.push(`Исправлено имя: ${name(op.person_id)} → ${String(op.name).trim()}`);
      if ('spouse' in op) {
        const who = 'name' in op ? String(op.name).trim() : name(op.person_id);
        const sp = String(op.spouse ?? '').trim();
        parts.push(sp ? `Подпись о супруге у ${who}: ${sp}` : `Подпись о супруге у ${who} убрана`);
      }
      return parts.join('; ');
    }
    case 'move': return `Перенесён: ${name(op.person_id)} (новый родитель — ${name(op.parent_id)})`;
    case 'delete': {
      const n = countBranch(snapshot, op.person_id);
      return n > 1 ? `Удалена ветка: ${name(op.person_id)} — ${n} чел.` : `Удалён: ${name(op.person_id)}`;
    }
    case 'marry': return `Брак: ${name(op.a_id)} и ${name(op.b_id)}`;
    case 'reorder': {
      const p = snapshot.people.find(x => x.id === op.person_id);
      const n = snapshot.people.filter(x => x.parent_id === p?.parent_id).length;
      return `Старшинство: ${name(op.person_id)} — ${Math.max(0, Math.min(op.index, n - 1)) + 1} из ${n} (родитель — ${name(p?.parent_id)})`;
    }
    case 'unmarry': {
      const m = snapshot.marriages.find(x => x.id === op.marriage_id);
      return m ? `Убран брак: ${name(m.a_id)} и ${name(m.b_id)}` : 'Убран брак';
    }
    default: return 'Изменение';
  }
}

// Люди, которых правка трогает.
export function opPeople(op, snapshot) {
  const ids = [op.person_id, op.parent_id, op.child_id, op.a_id, op.b_id];
  if (op.type === 'unmarry') {
    const m = snapshot.marriages.find(x => x.id === op.marriage_id);
    if (m) ids.push(m.a_id, m.b_id);
  }
  return ids.filter(Boolean);
}

// Убирает из черновика правки людей из конфликта, а потом — правки, которые без них уже не применить
// (например, ребёнок, добавленный к удалённому человеку).
export function dropConflicting(snapshot, ops, conflictIds) {
  const kept = ops.filter(op => !opPeople(op, snapshot).some(id => conflictIds.has(id)));
  const out = [];
  let s = snapshot;
  for (const op of kept) {
    try { s = applyOps(s, [op]); out.push(op); } catch { /* зависела от убранной правки */ }
  }
  return out;
}

// Описывает каждую правку относительно состояния перед ней.
export function describeOps(snapshot, ops) {
  const out = [];
  let s = snapshot;
  for (const op of ops) {
    out.push(describeOp(op, s));
    try { s = applyOps(s, [op]); } catch { /* описание остаётся, дальше — от прежнего состояния */ }
  }
  return out;
}

// Описание записи из истории: имена берутся из того, что сохранено в записи,
// потому что людей могли с тех пор удалить или переименовать.
export function describeEdit(edit, nameOf = () => undefined) {
  const { op, before: b, after: a } = edit;
  switch (op.type) {
    case 'add_child': return `Добавлен ребёнок: ${a.name}` + (nameOf(a.parent_id) ? ` (родитель — ${nameOf(a.parent_id)})` : '');
    case 'add_parent': return `Добавлен предок: ${a.person.name} (ребёнок — ${b.child.name})`;
    case 'update': {
      const parts = [];
      if ('name' in op) parts.push(`Исправлено имя: ${b.name} → ${a.name}`);
      if ('spouse' in op) parts.push(a.spouse ? `Подпись о супруге у ${a.name}: ${a.spouse}` : `Подпись о супруге у ${a.name} убрана`);
      return parts.join('; ');
    }
    case 'move': return `Перенесён: ${b.name}` + (nameOf(a.parent_id) ? ` (новый родитель — ${nameOf(a.parent_id)})` : '');
    case 'delete': return a.count > 1 ? `Удалена ветка: ${b.name} — ${a.count} чел.` : `Удалён: ${b.name}`;
    case 'marry': return `Брак: ${a.a} и ${a.b}`;
    case 'reorder': return `Старшинство: ${a.name} — ${a.index + 1} из ${a.count} (родитель — ${a.parent})`;
    case 'unmarry': return `Убран брак: ${b.a} и ${b.b}`;
    case 'revert': return 'Откат правки';
    default: return 'Изменение';
  }
}
