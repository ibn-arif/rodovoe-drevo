// «Мои древа»: древа, открытые в этом браузере по ссылке создателя. Хранятся только в localStorage.
import { safeLocalStorage } from './draft.js';

const MINE = 'drevo:my-trees';

export function myTrees() {
  try {
    const list = JSON.parse(safeLocalStorage()?.getItem(MINE) || '[]');
    return Array.isArray(list) ? list.filter(t => t && typeof t.owner === 'string') : [];
  } catch { return []; }
}

// Последнее открытое — первым; одно древо — одна строка, название обновляется.
export function rememberTree(title, owner) {
  try {
    const list = [{ title, owner }, ...myTrees().filter(t => t.owner !== owner)].slice(0, 50);
    safeLocalStorage()?.setItem(MINE, JSON.stringify(list));
  } catch { /* без хранилища */ }
}
