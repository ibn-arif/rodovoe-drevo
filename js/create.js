// Главная: создание древа и список своих древ.
import { getApi, errorText } from './api.js';
import { newToken, derive, hashToken, treeLink } from './tokens.js';
import { validateName } from './names.js';
import { renderShare } from './share.js';
import { myTrees, rememberTree, forgetTree } from './mine.js';

const $ = s => document.querySelector(s);

function showMine() {
  const list = myTrees();
  $('#mine').hidden = !list.length;
  $('#mine-list').replaceChildren(...list.map(t => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = treeLink(t.owner);
    a.textContent = t.title;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'btn btn-quiet mine-forget';
    x.textContent = '×';
    x.title = 'Убрать из списка';
    x.setAttribute('aria-label', `Убрать «${t.title}» из списка. Само древо останется, ссылки продолжат работать.`);
    x.addEventListener('click', () => { forgetTree(t.owner); showMine(); });
    li.append(a, x);
    return li;
  }));
}

const input = $('#root-name');
const titleInput = $('#tree-title');
let titleTouched = false;
titleInput.addEventListener('input', () => { titleTouched = titleInput.value.trim() !== ''; });
input.addEventListener('input', () => {
  const name = input.value.trim();
  $('#sprig-root').textContent = name || 'Родоначальник';
  // Склонять имена автоматически ненадёжно, поэтому название подставляется как есть и правится вручную.
  if (!titleTouched) titleInput.value = name ? 'Род ' + name : '';
});

$('#create').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#create-error');
  const name = validateName(input.value);
  if (!name.ok) { err.textContent = name.error; err.hidden = false; input.focus(); return; }
  err.hidden = true;
  const button = e.submitter ?? $('#create button');
  button.disabled = true;
  try {
    const owner = newToken();
    const edit = await derive(owner, 'edit'), view = await derive(owner, 'view');
    const title = titleInput.value.trim().slice(0, 120) || 'Род ' + name.value;
    await getApi().createTree(title, name.value, {
      owner: await hashToken(owner), edit: await hashToken(edit), view: await hashToken(view) });
    rememberTree(title, owner);
    $('#start').hidden = true;
    $('#steps').hidden = true;
    $('#mine').hidden = true;
    $('#done').hidden = false;
    $('#done-title').textContent = title;
    renderShare($('#share'), { owner, edit, view }, title.replace(/^Род/, 'древо рода'));
    $('#open-tree').href = treeLink(owner);
    $('#done-title').scrollIntoView();
  } catch (ex) {
    err.textContent = errorText(ex);
    err.hidden = false;
  } finally {
    button.disabled = false;
  }
});

if (location.hash === '#deleted') {
  $('#notice').textContent = 'Древо удалено. Ссылки на него больше не открываются.';
  $('#notice').hidden = false;
  history.replaceState(null, '', location.pathname);
}
showMine();
