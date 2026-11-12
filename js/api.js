// Обращения к серверу: одна функция API — один вызов (api/index.php на хостинге).
// В тестах страница подменяет API через window.__TEST_API__.
const API_URL = new URL('../api/index.php', import.meta.url).href;
const CODES = ['tree_not_found', 'forbidden', 'bad_name', 'bad_op', 'bad_token', 'cycle', 'root_protected',
  'not_root', 'too_many_trees', 'too_many_saves', 'too_large', 'already_reverted', 'cannot_revert', 'wrong_title'];

async function call(fn, args) {
  let res, body;
  try {
    res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args }) });
    body = await res.json();
  } catch {
    throw new Error('network');
  }
  if (!res.ok) throw new Error(CODES.includes(body?.error) ? body.error : 'network');
  return body.data;
}

export const serverApi = {
  createTree: (title, rootName, h) => call('create_tree', [title, rootName, h.owner, h.edit, h.view]),
  openTree: token => call('open_tree', [token]),
  treeVersion: token => call('tree_version', [token]),
  saveChanges: (token, author, baseVersion, ops, force = false) => call('save_changes', [token, author, baseVersion, ops, force]),
  getHistory: (token, limit = 50, before = null) => call('get_history', [token, limit, before]),
  revert: (token, author, saveId, editId = null) => call('revert', [token, author, saveId, editId]),
  deletedItems: token => call('deleted_items', [token]),
  deleteTree: (token, title) => call('delete_tree', [token, title]),
};

export function getApi() {
  return globalThis.__TEST_API__ ?? serverApi;
}

// Понятные сообщения об ошибках для людей.
export const ERROR_TEXT = {
  tree_not_found: 'Древо не найдено. Проверьте, что ссылка скопирована целиком.',
  forbidden: 'По этой ссылке так сделать нельзя.',
  bad_name: 'Проверьте имя: оно не может быть пустым, длиннее 100 символов или в несколько строк.',
  bad_op: 'Это изменение уже нельзя применить: древо поменялось. Обновите страницу.',
  cycle: 'Нельзя перенести человека в его собственную ветку.',
  root_protected: 'Самого верхнего человека нельзя удалить или перенести.',
  not_root: 'Предка можно добавить только самому верхнему человеку.',
  too_many_trees: 'Слишком много новых древ за короткое время. Попробуйте через час.',
  already_reverted: 'Это уже откачено.',
  wrong_title: 'Название не совпадает. Введите его точно так, как оно написано.',
  cannot_revert: 'Откатить нельзя: после этого древо изменилось, и откат его сломает. Сначала откатите более поздние изменения.',
  too_many_saves: 'Слишком много сохранений подряд. Подождите немного и сохраните ещё раз.',
  too_large: 'Слишком большое изменение или древо. Сохраните частями.',
  network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
};
export const errorText = e => ERROR_TEXT[e?.message] ?? ERROR_TEXT.network;
