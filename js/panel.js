// Панель человека: просмотр, а для родни и создателя — правки в черновик.
import { norm, parseSpouse, composeSpouse, guessRole } from './names.js';
import { countBranch } from './model.js';
import { ago } from './util.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  return el;
};
const btn = (text, onClick, cls = 'btn') => h('button', { type: 'button', class: cls, on: { click: onClick } }, text);
let seq = 0;
const field = (label, input) => {
  const id = 'f' + (++seq);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input);
};
const input = (value = '', attrs = {}) => {
  const el = h('input', { class: 'input', maxlength: 100, autocomplete: 'off', ...attrs });
  el.value = value;
  return el;
};

// ctx: { snapshot, role, personId, editing, setEditing(bool), addOp(op) -> string|null (ошибка), close(), goTo(id) }
export function renderPanel(el, ctx) {
  const s = ctx.snapshot;
  const p = s.people.find(x => x.id === ctx.personId);
  if (!p) { ctx.close(); return; }
  const parent = s.people.find(x => x.id === p.parent_id);
  const isRoot = p.id === s.root_id;
  const canEdit = ctx.role === 'edit' || ctx.role === 'owner';
  const name = id => s.people.find(x => x.id === id)?.name ?? '?';
  const marriages = s.marriages.filter(m => m.a_id === p.id || m.b_id === p.id);
  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const sub = h('div');
  const apply = op => {
    const err = ctx.addOp(op);
    if (err) { error.textContent = err; error.hidden = false; }
    return !err;
  };

  const head = h('div', { class: 'panel-head' },
    h('div', {},
      h('h2', { id: 'panel-name' }, p.name),
      parent ? h('p', { class: 'where' }, 'ребёнок: ', h('a', { href: '#', on: { click: e => { e.preventDefault(); ctx.goTo(parent.id); } } }, parent.name)) : null,
      p.updated_by ? h('p', { class: 'who' }, `Изменил(а) ${p.updated_by}, ${ago(p.updated_at)}`) : null,
      p.draft ? h('p', { class: 'who' }, 'Есть несохранённые изменения') : null),
    btn('Закрыть', ctx.close, 'btn btn-quiet'));

  const marList = marriages.length ? h('ul', { class: 'chips', 'aria-label': 'Браки в древе' }, marriages.map(m => {
    const other = m.a_id === p.id ? m.b_id : m.a_id;
    return h('li', {}, h('a', { href: '#', on: { click: e => { e.preventDefault(); ctx.goTo(other); } } }, '⚭ ' + name(other)),
      canEdit ? btn('убрать', () => apply({ type: 'unmarry', marriage_id: m.id }), 'btn btn-quiet') : null);
  })) : null;

  if (!canEdit) {
    el.replaceChildren(h('div', { class: 'panel-in' }, head,
      p.spouse ? h('p', {}, p.spouse) : null, marList,
      h('p', { class: 'muted' }, `Потомков: ${countBranch(s, p.id) - 1}`)));
    el.hidden = false;
    return;
  }

  // Супруг не из рода: кнопки «жена / муж» и имя. Роль угадывается по имени человека, пока её не выбрали.
  const parsed = parseSpouse(p.spouse);
  let role = parsed.role ?? guessRole(p.name);
  let guessed = !parsed.role;
  const nameIn = input(p.name);
  const spouseIn = input(parsed.name, { placeholder: 'только имя', 'aria-label': 'Имя супруга или супруги' });
  const help = h('span', { class: 'help muted small' });
  const roleBtns = ['жена', 'муж'].map(r => h('button', { type: 'button', 'data-r': r, on: { click: () => { guessed = false; setRole(r); } } }, r));
  function setRole(r) {
    role = r;
    roleBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.r === r)));
    help.textContent = guessed ? `Выбрано по имени: «${r}». Если неверно, переключите.` : '';
  }
  setRole(role);
  nameIn.addEventListener('input', () => { if (guessed) setRole(guessRole(nameIn.value)); });
  const spouseId = 'f' + (++seq);
  spouseIn.id = spouseId;
  const editForm = h('form', { class: 'panel-in', on: { submit: e => {
    e.preventDefault();
    const op = { type: 'update', person_id: p.id };
    if (nameIn.value.trim() !== p.name) op.name = nameIn.value;
    const sp = composeSpouse(role, spouseIn.value);
    if (sp !== p.spouse) op.spouse = sp;
    if ('name' in op || 'spouse' in op) apply(op);
  } } },
    field('Имя', nameIn),
    h('div', { class: 'field' },
      h('label', { for: spouseId }, 'Супруг или супруга не из этого рода'),
      h('div', { class: 'spwrap' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Кто' }, roleBtns), spouseIn),
      help),
    h('div', {}, h('button', { class: 'btn', type: 'submit' }, 'Применить')));

  // Маленькая форма «одно поле + кнопка».
  const nameForm = (label, button, onName) => {
    const inp = input();
    sub.replaceChildren(h('form', { class: 'subform', on: { submit: e => { e.preventDefault(); onName(inp.value); } } },
      field(label, inp), h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, button),
        btn('Отмена', () => sub.replaceChildren(), 'btn btn-quiet'))));
    inp.focus();
  };
  // Выбор человека из древа поиском.
  const pickForm = (label, exclude, onPick) => {
    const inp = input('', { type: 'search' });
    const list = h('div', { class: 'pick' });
    const fill = () => {
      const q = norm(inp.value.trim());
      const found = q ? s.people.filter(x => !exclude.has(x.id) && norm(x.name).includes(q)).slice(0, 30) : [];
      list.replaceChildren(...found.map(x => {
        const par = s.people.find(y => y.id === x.parent_id);
        return btn(x.name + (par ? ` — ребёнок: ${par.name}` : ''), () => onPick(x.id));
      }));
    };
    inp.addEventListener('input', fill);
    sub.replaceChildren(h('div', { class: 'subform' }, field(label, inp), list,
      h('div', {}, btn('Отмена', () => sub.replaceChildren(), 'btn btn-quiet'))));
    inp.focus();
  };
  const branch = () => {
    const ids = new Set([p.id]);
    let grew = true;
    while (grew) { grew = false; for (const x of s.people) if (ids.has(x.parent_id) && !ids.has(x.id)) { ids.add(x.id); grew = true; } }
    return ids;
  };

  const actions = h('div', { class: 'actions' },
    btn('＋ ребёнок', () => nameForm('Имя ребёнка', 'Добавить', v => {
      if (apply({ type: 'add_child', id: crypto.randomUUID(), parent_id: p.id, name: v, spouse: '' })) sub.replaceChildren();
    })),
    isRoot ? btn('＋ родитель', () => nameForm('Имя родителя', 'Добавить', v => {
      if (apply({ type: 'add_parent', id: crypto.randomUUID(), child_id: p.id, name: v, spouse: '' })) sub.replaceChildren();
    })) : null,
    !isRoot ? btn('Перенести к…', () => pickForm('Новый родитель', branch(), id => {
      if (apply({ type: 'move', person_id: p.id, parent_id: id })) sub.replaceChildren();
    })) : null,
    btn('Брак с…', () => pickForm('С кем брак', new Set([p.id, ...marriages.flatMap(m => [m.a_id, m.b_id])]), id => {
      if (apply({ type: 'marry', id: crypto.randomUUID(), a_id: p.id, b_id: id })) sub.replaceChildren();
    })),
    !isRoot ? btn('Удалить', () => {
      const n = countBranch(s, p.id);
      sub.replaceChildren(h('div', { class: 'subform' },
        h('p', {}, n > 1 ? `Будет удалено ${n} чел.: ${p.name} и вся ветка под ним(ней).` : `Будет удалено 1 чел.: ${p.name}.`),
        h('p', { class: 'muted small' }, 'Удаление попадёт в историю, создатель древа сможет его вернуть.'),
        h('div', { class: 'actions' }, btn('Да, удалить', () => { if (apply({ type: 'delete', person_id: p.id })) ctx.close(); }, 'btn btn-primary'),
          btn('Отмена', () => sub.replaceChildren(), 'btn btn-quiet'))));
    }, 'btn btn-danger') : null);

  editForm.hidden = !ctx.editing;
  const editToggle = btn('Исправить', () => { ctx.setEditing(true); editForm.hidden = false; nameIn.focus(); toggleBox.hidden = true; });
  const toggleBox = h('div', {}, editToggle);
  toggleBox.hidden = !!ctx.editing;
  el.replaceChildren(h('div', { class: 'panel-in' }, head, p.spouse ? h('p', {}, p.spouse) : null, toggleBox, editForm, marList, actions, sub, error));
  el.hidden = false;
}
