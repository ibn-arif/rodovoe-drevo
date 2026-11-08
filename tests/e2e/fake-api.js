// Тестовый API для страниц: настоящая схема (supabase/schema.sql) в PGlite внутри Node.
// Браузер зовёт window.__TEST_API__.*, вызов уходит в Node через exposeFunction —
// поэтому все вкладки одного теста видят одну базу, как на живом сайте.
import { freshDb, rpc } from '../sql/helpers.mjs';

const ARGS = {
  createTree: ['create_tree', (title, root, h) => [title, root, h.owner, h.edit, h.view]],
  openTree: ['open_tree', t => [t]],
  treeVersion: ['tree_version', t => [t]],
  saveChanges: ['save_changes', (t, a, b, ops, f = false) => [t, a, b, ops, f]],
  getHistory: ['get_history', (t, l = 50, b = null) => [t, l, b]],
  revert: ['revert', (t, a, s, e = null) => [t, a, s, e]],
  deletedItems: ['deleted_items', t => [t]],
};

export async function createBackend() {
  const db = await freshDb();
  return {
    db,
    async call(method, args) {
      const [fn, map] = ARGS[method];
      try {
        return { data: await rpc(db, fn, ...map(...args)) };
      } catch (e) {
        return { error: String(e.message) };
      }
    },
  };
}

// Ставит API в контекст браузера; страницы, открытые после этого, используют backend.
export async function installFakeApi(context, backend) {
  await context.exposeFunction('__fakeCall', (method, args) => backend.call(method, args));
  await context.addInitScript(methods => {
    const codes = ['tree_not_found', 'forbidden', 'bad_name', 'bad_op', 'bad_token', 'cycle', 'root_protected',
      'not_root', 'too_many_trees', 'already_reverted', 'cannot_revert'];
    window.__TEST_API__ = Object.fromEntries(methods.map(m => [m, async (...args) => {
      const r = await window.__fakeCall(m, JSON.parse(JSON.stringify(args)));
      if (r.error) throw new Error(codes.find(c => r.error.includes(c)) ?? 'network');
      return r.data;
    }]));
  }, Object.keys(ARGS));
}
