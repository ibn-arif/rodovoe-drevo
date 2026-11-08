import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const SCHEMA = new URL('../../supabase/schema.sql', import.meta.url);

export async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;`);
  await db.exec(readFileSync(SCHEMA, 'utf8'));
  return db;
}

// Runs a query the way the site does: as the anon role.
export async function asAnon(db, sql, params = []) {
  await db.exec('set role anon');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

// Calls an RPC function as anon and returns its single value.
export async function rpc(db, fn, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await asAnon(db, `select ${fn}(${ph}) as v`, args.map(a => (a !== null && typeof a === 'object') ? JSON.stringify(a) : a));
  return r.rows[0].v;
}

export async function setIp(db, ip) {
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': ip })]);
}

export const h = t => createHash('sha256').update(t, 'utf8').digest('hex');
export const tok = () => randomBytes(16).toString('base64url');

// Creates a tree and returns its tokens and ids.
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
