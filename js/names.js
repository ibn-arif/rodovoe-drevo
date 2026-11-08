// Имена: нормализация для поиска и проверка перед сохранением.
// Те же правила проверки, что в базе (drevo_private.clean_name).

// Аварская палочка Ӏ часто набирается как I, l или 1; ё — как е.
export function norm(s) {
  return String(s ?? '').replace(/[ӀӏIl1]/g, 'ӏ').toLowerCase().replace(/ё/g, 'е');
}

export function validateName(s) {
  const raw = String(s ?? '');
  if (/[\r\n]/.test(raw.trim())) return { ok: false, error: 'Имя в одну строку' };
  const value = raw.replace(/^[ \t]+|[ \t]+$/g, '');
  if (!value) return { ok: false, error: 'Введите имя' };
  if (value.length > 100) return { ok: false, error: 'Слишком длинное имя' };
  return { ok: true, value };
}
