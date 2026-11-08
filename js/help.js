// Подсказки для новичков: карточка при первом открытии древа и окно «Помощь».
import { safeLocalStorage } from './draft.js';

const COMMON = [
  'Нажмите на имя — откроется карточка человека.',
  'Кружок рядом с именем раскрывает и сворачивает ветку. «+5» значит, что в свёрнутой ветке ещё 5 человек.',
  'Двигайте древо пальцем или мышью. Увеличить — двумя пальцами или колёсиком мыши. «Раскрыть всё» покажет всё древо целиком, «Свернуть всё» оставит только родоначальника и его детей.',
  'Ищите людей через поле «Найти человека»: букву Ӏ можно набирать как I, l или 1.',
];

export const INTRO = {
  owner: {
    title: 'Вы создатель этого древа',
    items: [
      'Добавляйте людей: нажмите на имя, затем «＋ ребёнок». Исправить имя или вписать жену или мужа — кнопка «Исправить».',
      'Изменения сначала копятся в черновике. Когда закончите, нажмите «Сохранить» в жёлтой полосе сверху — тогда их увидят все.',
      'Позовите родных кнопкой «Пригласить родных»: отправьте им ссылку для родных в WhatsApp.',
      'Если кто-то ошибся или удалил ветку, откройте «История»: там можно откатить любую правку и вернуть удалённое. Это можете только вы.',
      'Сохраните свою ссылку (она сейчас в адресной строке): восстановить её нельзя.',
    ],
  },
  edit: {
    title: 'Вас пригласили дописать древо',
    items: [
      'Нажмите на имя человека, чтобы добавить его детей («＋ ребёнок») или исправить имя («Исправить»).',
      'Пока вы не нажмёте «Сохранить» в жёлтой полосе сверху, ваши изменения видите только вы. При сохранении сайт спросит, как вас подписать.',
      'Ошиблись? До сохранения можно убрать любой пункт в списке «Посмотреть». После — создатель древа сможет откатить правку.',
    ],
  },
  view: {
    title: 'Это древо открыто только для просмотра',
    items: [
      'Смотрите, ищите людей и скачивайте плакат кнопкой «Плакат PDF».',
      'Чтобы дописывать древо, попросите у его создателя ссылку для родных.',
    ],
  },
};

function render(container, role, withCommon) {
  const info = INTRO[role] ?? INTRO.view;
  const h = document.createElement('h2');
  h.textContent = info.title;
  const ul = document.createElement('ul');
  for (const t of [...info.items, ...(withCommon ? COMMON : [])]) {
    const li = document.createElement('li');
    li.textContent = t;
    ul.append(li);
  }
  container.replaceChildren(h, ul);
}

export function initHelp(role) {
  const store = safeLocalStorage();
  const key = `drevo:intro:${role}`;
  const intro = document.querySelector('#intro');
  let seen = false;
  try { seen = store?.getItem(key) === '1'; } catch { /* без хранилища */ }
  if (!seen) {
    render(intro.querySelector('.intro-body'), role, false);
    intro.showModal();
  }
  intro.querySelector('button').addEventListener('click', () => {
    intro.close();
    try { store?.setItem(key, '1'); } catch { /* без хранилища */ }
  });
  const dlg = document.querySelector('#help');
  document.querySelector('#help-btn').addEventListener('click', () => {
    render(dlg.querySelector('.help-body'), role, true);
    dlg.showModal();
  });
}
