// Имена: нормализация для поиска и проверка перед сохранением.
// Те же правила проверки, что в базе (drevo_private.clean_name).

// Аварская палочка Ӏ часто набирается как I, l или 1; ё — как е.
export function norm(s) {
  return String(s ?? '').replace(/[ӀӏIl1]/g, 'ӏ').toLowerCase().replace(/ё/g, 'е');
}

const EDGE = /^[ \t\u00a0\u200b-\u200d\u2060\ufeff]+|[ \t\u00a0\u200b-\u200d\u2060\ufeff]+$/g;
const CONTROL = /[\u0001-\u001f\u007f\u2028\u2029]/;
const VISIBLE = /[^ \t\u00a0\u200b-\u200f\u2060-\u2064\ufeff]/;

export function validateName(s) {
  const value = String(s ?? '').replace(EDGE, '');
  if (/[\r\n\u2028\u2029]/.test(value)) return { ok: false, error: 'Имя в одну строку' };
  if (!value || !VISIBLE.test(value) || CONTROL.test(value)) return { ok: false, error: 'Введите имя' };
  if (value.length > 100) return { ok: false, error: 'Слишком длинное имя' };
  return { ok: true, value };
}
