// Тесты серверной части: на каждый «db» — свой PHP-сервер (php -S) с чистой SQLite-базой.
// Интерфейс тот же, что у прежних тестов базы: freshDb(), rpc(db, fn, ...args), makeTree(), expectError().
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { after } from 'node:test';

const ROOT = new URL('../../', import.meta.url).pathname;
const servers = new Set();
after?.(() => { for (const s of servers) s.stop(); });
process.on('exit', () => { for (const s of servers) s.proc.kill(); });

const freePort = () => new Promise(resolve => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

export async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'drevo-'));
  const port = await freePort();
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', ROOT, join(ROOT, 'tests/api/router.php')], {
    env: { ...process.env, DREVO_DSN: `sqlite:${join(dir, 'db.sqlite')}`, DREVO_TEST: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const db = { url: `http://127.0.0.1:${port}/api/index.php`, proc, ip: null,
    stop() { proc.kill(); rmSync(dir, { recursive: true, force: true }); servers.delete(db); } };
  servers.add(db);
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/api/index.php`, { method: 'POST', body: '{"fn":"ping","args":[]}' }); return db; }
    catch { await new Promise(r => setTimeout(r, 50)); }
  }
  throw new Error('php server did not start');
}

// Вызов функции API; ошибка API → Error с её кодом.
export async function rpc(db, fn, ...args) {
  const headers = { 'Content-Type': 'application/json' };
  if (db.ip) headers['X-Test-Ip'] = db.ip;
  const r = await fetch(db.url, { method: 'POST', headers, body: JSON.stringify({ fn, args }) });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? 'network');
  return body.data;
}

// В тестах адрес клиента задаётся заголовком (сервер читает его только при DREVO_TEST=1).
export function setIp(db, ip) { db.ip = ip; }

export const h = t => createHash('sha256').update(t, 'utf8').digest('hex');
export const tok = () => randomBytes(16).toString('base64url');

export async function makeTree(db, rootName = 'Магомед', title = 'Род Магомеда') {
  const o = tok(), e = tok(), v = tok();
  const r = await rpc(db, 'create_tree', title, rootName, h(o), h(e), h(v));
  return { o, e, v, treeId: r.tree_id, rootId: r.root_id };
}

export async function expectError(promise, code) {
  try {
    await promise;
  } catch (err) {
    if (!String(err.message).includes(code)) throw new Error(`expected ${code}, got: ${err.message}`);
    return;
  }
  throw new Error(`expected error ${code}, but call succeeded`);
}
