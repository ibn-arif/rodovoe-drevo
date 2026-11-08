// Полоска черновика: счётчик, список изменений, «Сохранить» и разбор конфликтов.
import { describeOps, dropConflicting } from './model.js';
import { validateName } from './names.js';
import { plural, ago } from './util.js';
import { errorText } from './api.js';
import { safeLocalStorage } from './draft.js';

const $ = s => document.querySelector(s);
const AUTHOR = 'drevo:author';


// app: { state, api, refresh(): Promise, rerender() }
export function initDraftBar(app) {
  const store = safeLocalStorage();
  const bar = $('#draft-bar'), list = $('#draft-list'), details = $('#draft-details');
  const dlg = $('#save-dialog'), author = $('#author'), err = $('#save-error'), box = $('#conflicts');

  function render() {
    const { draft, server, stale } = app.state;
    const n = draft.ops.length;
    bar.hidden = n === 0;
    if (!n) { details.hidden = true; return; }
    $('#draft-count').textContent = `${n} ${plural(n, 'несохранённое изменение', 'несохранённых изменения', 'несохранённых изменений')}`;
    $('#draft-volatile').hidden = draft.persistent;
    $('#draft-stale').hidden = !stale;
    $('#draft-toggle').textContent = details.hidden ? 'Посмотреть' : 'Скрыть';
    const texts = describeOps(server, draft.ops);
    list.replaceChildren(...texts.map((t, i) => {
      const li = document.createElement('li');
      li.textContent = t;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-quiet';
      b.textContent = 'убрать';
      b.setAttribute('aria-label', 'Убрать: ' + t);
      b.addEventListener('click', () => { draft.remove(i); });
      li.append(b);
      return li;
    }));
  }

  $('#draft-toggle').addEventListener('click', () => { details.hidden = !details.hidden; render(); });
  $('#draft-clear').addEventListener('click', () => {
    if (confirm('Отменить все несохранённые изменения?')) app.state.draft.clear();
  });
  $('#draft-save').addEventListener('click', () => {
    try { author.value = store?.getItem(AUTHOR) || author.value; } catch { /* без хранилища */ }
    err.hidden = true;
    box.hidden = true;
    $('#save-actions').hidden = false;
    dlg.showModal();
    if (!author.value) author.focus();
  });

  async function save(force = false) {
    const name = validateName(author.value);
    if (!name.ok) { err.textContent = name.error; err.hidden = false; author.focus(); return; }
    try { store?.setItem(AUTHOR, name.value); } catch { /* без хранилища */ }
    const { draft, token } = app.state;
    const button = $('#save-confirm');
    button.disabled = true;
    try {
      const r = await app.api.saveChanges(token, name.value, draft.baseVersion, draft.ops, force);
      if (!r.ok) { showConflicts(r.conflicts); return; }
      draft.clear();
      dlg.close();
      await app.refresh();
    } catch (e) {
      err.textContent = errorText(e);
      err.hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  function showConflicts(conflicts) {
    const ul = document.createElement('ul');
    for (const c of conflicts) {
      const li = document.createElement('li');
      li.textContent = c.reason === 'deleted'
        ? `${c.name} — уже удалён(а): ${c.by}, ${ago(c.at)}`
        : `${c.name} — уже изменил(а) ${c.by}, ${ago(c.at)}`;
      ul.append(li);
    }
    const p = document.createElement('p');
    p.textContent = 'Пока вы правили, эти люди уже изменились:';
    const actions = document.createElement('div');
    actions.className = 'dlg-actions';
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'btn';
    drop.textContent = 'Убрать эти пункты';
    drop.addEventListener('click', async () => {
      const ids = new Set(conflicts.map(c => c.person_id));
      const { draft } = app.state;
      dlg.close();
      await app.refresh();
      const keep = dropConflicting(app.state.server, draft.ops, ids);
      draft.clear();
      keep.forEach(op => draft.add(op));
      draft.setBase(app.state.server.version);
    });
    const over = document.createElement('button');
    over.type = 'button';
    over.className = 'btn btn-primary';
    over.textContent = 'Сохранить поверх';
    over.addEventListener('click', () => save(true));
    // Удалённых людей «поверх» не сохранить — кнопку не показываем.
    if (conflicts.some(c => c.reason === 'deleted')) actions.append(drop); else actions.append(drop, over);
    box.replaceChildren(p, ul, actions);
    box.hidden = false;
    $('#save-actions').hidden = true;
  }

  $('#save-confirm').addEventListener('click', () => save(false));
  $('#save-form').addEventListener('submit', e => { if (e.submitter?.value !== 'cancel') { e.preventDefault(); save(false); } });

  return { render };
}
