// «Пригласить родных»: ссылки с кнопками «Отправить в WhatsApp» и «Копировать».
import { treeLink } from './tokens.js';

const KINDS = [
  ['owner', 'Ваша ссылка создателя', 'Только для вас: с ней можно откатывать правки и возвращать удалённое.'],
  ['edit', 'Ссылка для родных', 'Кто откроет её, сможет дописывать и исправлять древо.'],
  ['view', 'Ссылка для просмотра', 'Можно смотреть древо и скачать плакат, менять нельзя.'],
];

export function renderShare(el, tokens, title = 'наше родовое древо') {
  el.replaceChildren();
  for (const [kind, heading, note] of KINDS) {
    if (!tokens[kind]) continue;
    const link = treeLink(tokens[kind]);
    const box = document.createElement('div');
    box.className = 'share-link';
    box.innerHTML = `<h3></h3><p></p><div class="share-row"><input class="input" readonly aria-label=""></div>`;
    box.querySelector('h3').textContent = heading;
    box.querySelector('p').textContent = note;
    const input = box.querySelector('input');
    input.value = link;
    input.setAttribute('aria-label', heading);
    input.addEventListener('focus', () => input.select());
    const row = box.querySelector('.share-row');

    if (kind !== 'owner') {
      const wa = document.createElement('a');
      wa.className = 'btn';
      wa.target = '_blank';
      wa.rel = 'noopener';
      wa.style.textDecoration = 'none';
      wa.textContent = 'Отправить в WhatsApp';
      const text = kind === 'edit'
        ? `Собираем ${title}. Добавь тех, кого знаешь: ${link}`
        : `Посмотри ${title}: ${link}`;
      wa.href = 'https://wa.me/?text=' + encodeURIComponent(text);
      row.append(wa);
    } else {
      const warn = document.createElement('p');
      warn.className = 'warn';
      warn.textContent = 'Сохраните эту ссылку — восстановить её нельзя.';
      box.append(warn);
    }
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn';
    copy.textContent = 'Копировать';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); } catch { input.select(); document.execCommand?.('copy'); }
      copy.textContent = 'Скопировано';
      setTimeout(() => { copy.textContent = 'Копировать'; }, 1600);
    });
    row.append(copy);
    el.append(box);
  }
}
