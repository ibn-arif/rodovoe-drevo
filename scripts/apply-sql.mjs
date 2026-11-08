// Применяет SQL-файлы к базе Supabase.
//   SUPABASE_DB_URL='postgresql://…' node scripts/apply-sql.mjs supabase/schema.sql supabase/example.sql
// Строку подключения не коммитить.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('Нет SUPABASE_DB_URL'); process.exit(1); }
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  for (const file of process.argv.slice(2)) {
    await sql.unsafe(readFileSync(file, 'utf8'));
    console.log('✓', file);
  }
} finally {
  await sql.end();
}
