// История правок. Родня видит, кто что менял; создатель может откатить сохранение
// целиком или одну правку, а на вкладке «Удалённое» — вернуть удалённых.
import { describeEdit } from './model.js';
import { ago } from './util.js';
import { errorText } from './api.js';
import { safeLocalStorage } from './draft.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (text, onClick, cls = 'btn btn-quiet') => {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

// app: { state, api, refresh() }
export function initHistory(app) {
  const dlg = document.querySelector('#history');
  const body = dlg.querySelector('.history-body');
  const tabs = dlg.querySelector('.tabs');
  const status = dlg.querySelector('.history-status');
  const isOwner = () => app.state.role === 'owner';
  let saves = [], tab = 'all', done = false;

  const nameOf = id => app.state.server.people.find(p => p.id === id)?.name;
  const author = () => {
    try { return safeLocalStorage()?.getItem('drevo:author') || 'Создатель'; } catch { return 'Создатель'; }
  };

  // Кто менял тех же людей после этого сохранения (по загруженной истории).
  function laterChanges(save, edits) {
    const ids = new Set(edits.flatMap(e => e.people || []));
    const out = [];
    for (const s of saves) {
      if (s.save_id <= save.save_id) continue;
      for (const e of s.edits) {
        const hit = (e.people || []).find(id => ids.has(id));
        if (hit) out.push({ id: hit, name: nameOf(hit) ?? 'этого человека', by: s.author });
      }
    }
    const seen = new Set();
    return out.filter(w => !seen.has(w.id) && seen.add(w.id));
  }

  async function revert(save, edit) {
    const edits = edit ? [edit] : save.edits.filter(e => !e.reverted_by);
    const warn = laterChanges(save, edits);
    if (warn.length && !confirm(warn.map(w => `После этого ${w.name} ещё менял(а) ${w.by}.`).join('\n') + '\nВсё равно откатить?')) return;
    status.textContent = '';
    try {
      await app.api.revert(app.state.token, author(), save.save_id, edit ? edit.edit_id : null);
      await load(true);
      await app.refresh();
    } catch (e) {
      status.textContent = errorText(e);
    }
  }

  function renderAll() {
    if (!saves.length) { body.replaceChildren(el('p', 'muted', 'Изменений пока нет.')); return; }
    const list = el('div', 'history-list');
    if (!isOwner()) list.append(el('p', 'muted small', 'Здесь видно, кто и что менял. Откатить изменение может только создатель древа — если кто-то ошибся, напишите ему.'));
    else list.append(el('p', 'muted small', '«Откатить» отменяет правку, но не стирает её: откат тоже попадёт в историю.'));
    for (const s of saves) {
      const box = el('section', 'save' + (s.reverts_save ? ' is-revert' : ''));
      const head = el('div', 'save-head');
      head.append(el('h3', '', s.author), el('span', 'muted', ago(s.at) + (s.reverts_save ? ', откат' : '')));
      box.append(head);
      const ul = el('ul', 'edits');
      for (const e of s.edits) {
        const li = el('li', e.reverted_by ? 'reverted' : '');
        const text = el(e.reverted_by ? 's' : 'span', '', describeEdit(e, nameOf));
        li.append(text);
        if (e.reverted_by) li.append(el('span', 'muted', ' — откачено'));
        else if (isOwner() && !s.reverts_save) li.append(button('Откатить', () => revert(s, e)));
        ul.append(li);
      }
      box.append(ul);
      const open = s.edits.filter(e => !e.reverted_by);
      if (isOwner() && !s.reverts_save && open.length > 1) box.append(button('Откатить всё сохранение', () => revert(s, null), 'btn'));
      list.append(box);
    }
    body.replaceChildren(list);
    if (!done) body.append(button('Показать ещё', () => load(false), 'btn'));
  }

  async function renderDeleted() {
    body.replaceChildren(el('p', 'muted', 'Загружаю…'));
    try {
      const items = await app.api.deletedItems(app.state.token);
      if (!items.length) { body.replaceChildren(el('p', 'muted', 'Удалённого нет.')); return; }
      const ul = el('ul', 'edits');
      for (const d of items) {
        const li = el('li');
        li.append(el('span', '', d.count > 1 ? `${d.name} — ${d.count} чел.` : `${d.name} — 1 чел.`),
          el('span', 'muted', ` удалил(а) ${d.by}, ${ago(d.at)} `),
          button('Вернуть', async () => {
            status.textContent = '';
            try {
              await app.api.revert(app.state.token, author(), d.save_id, d.edit_id);
              await app.refresh();
              await load(true);
              await renderDeleted();
            } catch (e) { status.textContent = errorText(e); }
          }));
        ul.append(li);
      }
      body.replaceChildren(ul);
    } catch (e) {
      body.replaceChildren(el('p', 'error', errorText(e)));
    }
  }

  async function load(reset) {
    const before = reset || !saves.length ? null : saves[saves.length - 1].save_id;
    const page = await app.api.getHistory(app.state.token, 50, before);
    saves = reset ? page : [...saves, ...page];
    done = page.length < 50;
    if (tab === 'all') renderAll();
  }

  function setTab(name) {
    tab = name;
    tabs.querySelectorAll('[role=tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    if (name === 'all') renderAll(); else renderDeleted();
  }

  tabs.hidden = !isOwner();
  tabs.querySelectorAll('[role=tab]').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

  return {
    async open() {
      status.textContent = '';
      body.replaceChildren(el('p', 'muted', 'Загружаю…'));
      dlg.showModal();
      tab = 'all';
      setTab('all');
      try { await load(true); } catch (e) { body.replaceChildren(el('p', 'error', errorText(e))); }
    },
  };
}
