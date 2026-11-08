// Обращения к базе: один вызов — одна функция Postgres (supabase/schema.sql).
// В тестах страница подменяет API через window.__TEST_API__.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
const CODES = ['tree_not_found', 'forbidden', 'bad_name', 'bad_op', 'bad_token', 'cycle', 'root_protected',
  'not_root', 'too_many_trees', 'already_reverted', 'cannot_revert'];

let clientPromise;
function client() {
  clientPromise ??= import(SUPABASE_JS).then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } }));
  return clientPromise;
}

async function call(fn, args) {
  let res;
  try {
    res = await (await client()).rpc(fn, args);
  } catch {
    throw new Error('network');
  }
  if (res.error) {
    const msg = `${res.error.message} ${res.error.details ?? ''}`;
    throw new Error(CODES.find(c => msg.includes(c)) ?? 'network');
  }
  return res.data;
}

export const supabaseApi = {
  createTree: (title, rootName, h) => call('create_tree', {
    p_title: title, p_root_name: rootName, p_owner_hash: h.owner, p_edit_hash: h.edit, p_view_hash: h.view }),
  openTree: token => call('open_tree', { p_token: token }),
  treeVersion: token => call('tree_version', { p_token: token }),
  saveChanges: (token, author, baseVersion, ops, force = false) => call('save_changes', {
    p_token: token, p_author: author, p_base_version: baseVersion, p_ops: ops, p_force: force }),
  getHistory: (token, limit = 50, before = null) => call('get_history', { p_token: token, p_limit: limit, p_before: before }),
  revert: (token, author, saveId, editId = null) => call('revert', {
    p_token: token, p_author: author, p_save_id: saveId, p_edit_id: editId }),
  deletedItems: token => call('deleted_items', { p_token: token }),
};

export function getApi() {
  return globalThis.__TEST_API__ ?? supabaseApi;
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
  cannot_revert: 'Откатить нельзя: прежнего родителя больше нет в древе.',
  network: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
};
export const errorText = e => ERROR_TEXT[e?.message] ?? ERROR_TEXT.network;
