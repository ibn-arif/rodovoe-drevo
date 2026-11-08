// Страница древа: загрузка по токену, роли, черновик поверх снимка, опрос версии.
import { getApi, errorText, ERROR_TEXT } from './api.js';
import { readTokenFromHash, derive } from './tokens.js';
import { applyOps, buildTree } from './model.js';
import { createDraft } from './draft.js';
import { norm } from './names.js';
import { plural } from './util.js';
import { createTreeView } from './tree-view.js';
import { renderPanel } from './panel.js';
import { initDraftBar } from './draft-bar.js';
import { renderShare } from './share.js';
import { initHistory } from './history.js';
import { initPoster } from './poster/dialog.js';

const $ = s => document.querySelector(s);
const api = getApi();
const POLL_MS = globalThis.__POLL_MS__ ?? 15000;

const state = { token: readTokenFromHash(location.hash), role: null, server: null, view: null, draft: null, stale: false, selectedId: null, query: '' };
const app = { state, api, refresh, rerender };
let view, bar, polling = false;

function fatal(text) {
  $('#title').textContent = 'Родовое древо';
  $('#fatal').textContent = text;
  $('#fatal').hidden = false;
  $('#stage').hidden = true;
}

function recompute() {
  try {
    state.view = applyOps(state.server, state.draft.ops);
    state.stale = false;
  } catch {
    state.view = state.server;
    state.stale = true;
  }
}

function addOp(op) {
  try {
    applyOps(state.view, [op]);
  } catch (e) {
    return ERROR_TEXT[e.message] ?? 'Так изменить нельзя.';
  }
  state.draft.add(op);
  return null;
}

function rerender() {
  recompute();
  const v = state.view;
  document.title = `${state.server.title} — Родовое древо`;
  $('#title').textContent = state.server.title;
  $('#count').textContent = `${v.people.length} чел.`;
  view.render(buildTree(v), { query: state.query, selectedId: state.selectedId, marriages: v.marriages });
  renderFound();
  if (state.selectedId) openPanel(state.selectedId);
  bar.render();
}

function openPanel(id) {
  if (state.selectedId !== id) state.editing = false;
  state.selectedId = id;
  renderPanel($('#panel'), {
    snapshot: state.view, role: state.role, personId: id, addOp,
    editing: state.editing, setEditing: v => { state.editing = v; },
    close: () => { state.selectedId = null; $('#panel').hidden = true; view.render(buildTree(state.view), { selectedId: null }); },
    goTo: other => { view.focus(other); openPanel(other); view.render(buildTree(state.view), { selectedId: other }); },
  });
}

function renderFound() {
  const box = $('#found');
  const q = norm(state.query.trim());
  if (!q) { box.replaceChildren(); return; }
  const found = state.view.people.filter(p => norm(p.name).includes(q));
  const parentName = p => state.view.people.find(x => x.id === p.parent_id)?.name;
  const note = document.createElement('span');
  note.className = 'muted';
  note.textContent = found.length ? `Найдено: ${found.length}` : 'Никого не нашли';
  box.replaceChildren(note, ...found.slice(0, 20).map(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name + (parentName(p) ? ` (ребёнок: ${parentName(p)})` : '');
    b.addEventListener('click', () => { view.focus(p.id); openPanel(p.id); rerender(); });
    return b;
  }));
}

async function refresh() {
  state.server = await api.openTree(state.token);
  if (!state.draft.ops.length) state.draft.setBase(state.server.version);
  rerender();
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const v = await api.treeVersion(state.token);
    if (Number(v) !== Number(state.server.version)) await refresh();
  } catch { /* нет связи — попробуем позже */ }
  polling = false;
}

async function main() {
  if (!state.token) { fatal('В ссылке нет ключа древа. Попросите прислать ссылку ещё раз.'); return; }
  try {
    state.server = await api.openTree(state.token);
  } catch (e) {
    fatal(e.message === 'tree_not_found' ? ERROR_TEXT.tree_not_found : errorText(e));
    return;
  }
  state.role = state.server.role;
  state.draft = createDraft(state.server.tree_id);
  if (!state.draft.ops.length) state.draft.setBase(state.server.version);
  view = createTreeView($('#stage'), {
    coveredBottom: () => {
      const p = $('#panel');
      return !p.hidden && getComputedStyle(p).position === 'fixed' ? p.offsetHeight : 0;
    },
    onSelect: id => {
    openPanel(id);
    rerender();
    // На телефоне панель выезжает снизу — держим выбранного человека над ней.
    if (matchMedia('(max-width: 899px)').matches) view.focus(id);
  } });
  bar = initDraftBar(app);
  state.draft.onChange(() => rerender());

  const canEdit = state.role === 'edit' || state.role === 'owner';
  $('#tools').hidden = false;
  $('#invite').hidden = !canEdit;
  $('#history-btn').hidden = !canEdit;
  $('#poster-btn').hidden = false;
  const poster = initPoster(() => state.view, () => state.server.title);
  $('#poster-btn').addEventListener('click', () => poster.open());
  if (canEdit) {
    const history = initHistory(app);
    $('#history-btn').addEventListener('click', () => history.open());
  }
  $('#q').addEventListener('input', e => { state.query = e.target.value; rerender(); });
  $('#expand-all').addEventListener('click', () => view.expandAll());
  $('#invite').addEventListener('click', async () => {
    const tokens = state.role === 'owner'
      ? { owner: state.token, edit: await derive(state.token, 'edit'), view: await derive(state.token, 'view') }
      : { edit: state.token };
    renderShare($('#invite-share'), tokens, state.server.title.replace(/^Род/, 'древо рода'));
    $('#invite-dialog').showModal();
  });
  window.addEventListener('hashchange', () => location.reload());
  rerender();
  setInterval(poll, POLL_MS);
}

main();
