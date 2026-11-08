// Мелочи для текстов интерфейса.

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

export function ago(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const min = Math.round((now - t) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const d = new Date(t);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === y.toDateString()) return `вчера, ${time}`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === y.getFullYear() ? undefined : 'numeric' }) + `, ${time}`;
}
