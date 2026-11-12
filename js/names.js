// Имена: нормализация для поиска и проверка перед сохранением.
// Те же правила проверки, что на сервере (api/lib.php, cleanName).

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

// Супруг не из рода: «жена Асият» / «муж Ахмед». Роль выбирается кнопками, в поле — только имя.
const ROLE_RE = /^(жена|муж|жёны|жены)\s+(.*)$/i;

export function parseSpouse(sp) {
  const s = String(sp ?? '').trim();
  const m = ROLE_RE.exec(s);
  if (!m) return { role: null, name: s };
  return { role: m[1].toLowerCase() === 'муж' ? 'муж' : 'жена', name: m[2].trim() };
}

export function composeSpouse(role, name) {
  const n = String(name ?? '').trim().replace(ROLE_RE, '$2').trim();
  return n ? `${role} ${n}` : '';
}

// Угадываем по имени человека: женские аварские имена обычно на -ат, -ят, -а, -я.
const MALE = new Set(['марат', 'муса', 'иса', 'мустафа', 'ӏиса', 'ӏиса'].map(norm));
const FEMALE = new Set(['зайнаб', 'марьям', 'мариям', 'майсарат', 'рабиъат'].map(norm));
export function guessRole(personName) {
  const n = norm(String(personName ?? '').trim().split(/\s+/)[0] || '');
  const female = FEMALE.has(n) || (!MALE.has(n) && !/(ула|улла)$/.test(n) && /(ат|ят|а|я)$/.test(n));
  return female ? 'муж' : 'жена';
}
