import { test, expect } from '@playwright/test';
import { randomUUID as uid } from 'node:crypto';
import { createBackend, installFakeApi } from './fake-api.js';
import { rpc, makeTree } from '../sql/helpers.mjs';

async function seed() {
  const backend = await createBackend();
  const t = await makeTree(backend.db);
  await rpc(backend.db, 'save_changes', t.o, 'Создатель', 0, [{ type: 'add_child', id: uid(), parent_id: t.rootId, name: 'Али', spouse: '' }], false);
  return { backend, ...t };
}

test('home answers common questions', async ({ page, context }) => {
  await installFakeApi(context, await createBackend());
  await page.goto('index.html');
  await expect(page.getByRole('heading', { name: 'Частые вопросы' })).toBeVisible();
  for (const q of ['Зачем три ссылки?', 'Кто увидит наше древо?', 'Нужно ли регистрироваться?', 'Я потерял ссылку создателя']) {
    await expect(page.locator('details summary', { hasText: q })).toBeVisible();
  }
});

for (const [role, text] of [['o', 'Вы создатель этого древа'], ['e', 'Вас пригласили дописать древо'], ['v', 'Это древо открыто только для просмотра']]) {
  test(`first visit intro for ${role}`, async ({ page, context }) => {
    const s = await seed();
    await installFakeApi(context, s.backend, { intro: true });
    await page.goto('tree.html#t=' + s[role]);
    const intro = page.locator('#intro');
    await expect(intro).toContainText(text);
    await intro.getByRole('button', { name: 'Понятно' }).click();
    await expect(intro).toBeHidden();
    await page.reload();
    await expect(page.locator('.node').first()).toBeVisible();
    await expect(intro).toBeHidden();
    await page.getByRole('button', { name: 'Помощь' }).click();
    await expect(page.locator('#help')).toContainText(text);
  });
}

test('panel and dialogs explain themselves', async ({ page, context }) => {
  const s = await seed();
  await installFakeApi(context, s.backend, { intro: true });
  await page.goto('tree.html#t=' + s.o);
  await page.locator('#intro').getByRole('button', { name: 'Понятно' }).click();
  await page.locator('text.nm >> text="Али"').click();
  await page.getByRole('button', { name: 'Перенести к…' }).click();
  await expect(page.locator('#panel')).toContainText('если человек записан не у того родителя');
  await page.getByRole('button', { name: 'Брак с…' }).click();
  await expect(page.locator('#panel')).toContainText('оба супруга есть в этом древе');
  await page.getByRole('button', { name: 'Исправить' }).click();
  await expect(page.locator('#panel')).toContainText('Если супруг или супруга тоже есть в древе, нажмите «Брак с…»');
  await page.getByRole('button', { name: '＋ ребёнок' }).click();
  await page.getByLabel('Имя ребёнка').fill('Иса');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.getByRole('button', { name: 'Посмотреть' }).click();
  await expect(page.locator('#draft-bar')).toContainText('Пока вы не нажмёте «Сохранить», эти изменения видите только вы');
  await page.getByRole('button', { name: 'Плакат PDF' }).click();
  await expect(page.locator('#poster')).toContainText('A4 — обычный лист для домашнего принтера');
});

test('intro button keeps its size when the dialog is tall (Safari)', async ({ page, context }) => {
  const s = await seed();
  await installFakeApi(context, s.backend, { intro: true });
  await page.goto('tree.html#t=' + s.o);
  // Safari задаёт окну высоту; повторяем это, чтобы проверить, что строки не растягиваются.
  await page.locator('#intro').evaluate(d => { d.style.height = '900px'; d.style.maxHeight = 'none'; });
  const btn = await page.locator('#intro button').boundingBox();
  expect(btn.height).toBeLessThan(60);
  // Между пунктами нет растянутых пустот: следующий начинается сразу под предыдущим.
  const gap = await page.locator('#intro li').evaluateAll(els => els[1].getBoundingClientRect().top - els[0].getBoundingClientRect().bottom);
  expect(gap).toBeLessThan(16);
});
