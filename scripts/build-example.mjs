// data/romanov.json → supabase/example.sql: древо-пример, открытое всем по ссылке tree.html#t=romanovy.
// Ссылки создателя и родни печатаются в консоль и в репозиторий не попадают.
//   node scripts/build-example.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const VIEW_TOKEN = 'romanovy';
const sha = s => createHash('sha256').update(s, 'utf8');
const hash = t => sha(t).digest('hex');
const derive = (owner, role) => sha(`${owner}:${role}`).digest('base64url').slice(0, 22);
const q = s => `'${String(s).replace(/'/g, "''")}'`;

export function buildExampleSql(data, ownerToken = randomBytes(16).toString('base64url')) {
  const rows = [];
  (function walk(n, parentId, pos) {
    const id = randomUUID();
    rows.push(`(${q(id)}, v_tree, ${parentId ? q(parentId) + '::uuid' : 'null'}, ${pos}, ${q(n.n)}, ${q(n.sp ?? '')}, 'Пример')`);
    (n.c || []).forEach((c, i) => walk(c, id, i));
  })(data.root, null, 0);
  const rootId = rows[0].slice(2, 38);
  const sql = `-- Сгенерировано scripts/build-example.mjs из data/romanov.json. Не править руками.
do $$
declare v_tree uuid;
begin
  if exists (select 1 from public.trees where view_hash = ${q(hash(VIEW_TOKEN))}) then return; end if;
  insert into public.trees(title, owner_hash, edit_hash, view_hash, is_example)
    values (${q(data.title)}, ${q(hash(ownerToken))}, ${q(hash(derive(ownerToken, 'edit')))}, ${q(hash(VIEW_TOKEN))}, true)
    returning id into v_tree;
  insert into public.people(id, tree_id, parent_id, pos, name, spouse, updated_by) values
    ${rows.join(',\n    ')};
  update public.trees set root_id = ${q(rootId)} where id = v_tree;
end $$;
`;
  return { sql, ownerToken };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(new URL('../data/romanov.json', import.meta.url), 'utf8'));
  const { sql, ownerToken } = buildExampleSql(data);
  writeFileSync(new URL('../supabase/example.sql', import.meta.url), sql);
  console.log('supabase/example.sql готов. Ссылка создателя примера (не публиковать):');
  console.log(`  tree.html#t=${ownerToken}`);
}
