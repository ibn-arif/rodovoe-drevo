import { test, expect } from '@playwright/test';
import { randomUUID as uid } from 'node:crypto';
import { createBackend, installFakeApi } from './fake-api.js';
import { rpc, makeTree } from '../sql/helpers.mjs';

// Магомед → Али → Расул; Магомед → Патимат → ХӀасан
async function seed() {
  const backend = await createBackend();
  const t = await makeTree(backend.db);
  const ali = uid(), pat = uid();
  await rpc(backend.db, 'save_changes', t.o, 'Создатель', 0, [
    { type: 'add_child', id: ali, parent_id: t.rootId, name: 'Али', spouse: '' },
    { type: 'add_child', id: uid(), parent_id: ali, name: 'Расул', spouse: '' },
    { type: 'add_child', id: pat, parent_id: t.rootId, name: 'Патимат', spouse: 'муж Ахмед' },
    { type: 'add_child', id: uid(), parent_id: pat, name: 'ХӀасан', spouse: '' },
  ], false);
  return { backend, ...t };
}

async function openTree(browser, backend, token) {
  const context = await browser.newContext();
  await installFakeApi(context, backend);
  await context.addInitScript(() => { window.__POLL_MS__ = 300; });
  const page = await context.newPage();
  await page.goto('tree.html#t=' + token);
  await expect(page.locator('.node').first()).toBeVisible();
  return page;
}
const node = (page, name) => page.locator('.node', { has: page.locator(`text.nm >> text="${name}"`) }).first();
async function select(page, name) {
  await node(page, name).locator('text.nm').click();
  await expect(page.locator('#panel h2')).toHaveText(name);
}
async function addChild(page, parent, name) {
  await select(page, parent);
  await page.getByRole('button', { name: '＋ ребёнок' }).click();
  await page.getByLabel('Имя ребёнка').fill(name);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
}

test('view role is read-only', async ({ browser }) => {
  const s = await seed();
  const page = await openTree(browser, s.backend, s.v);
  await select(page, 'Али');
  await expect(page.getByRole('button', { name: 'Удалить' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '＋ ребёнок' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'История' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Пригласить родных' })).toHaveCount(0);
});

test('draft and save', async ({ browser }) => {
  const s = await seed();
  const page = await openTree(browser, s.backend, s.e);
  const other = await openTree(browser, s.backend, s.e);
  await addChild(page, 'Магомед', 'Иса');
  await addChild(page, 'Магомед', 'Муса');
  await select(page, 'Али');
  await page.getByRole('button', { name: 'Исправить' }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Алий');
  await page.getByRole('button', { name: 'Применить' }).click();
  await select(page, 'Алий');
  await page.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByText('Будет удалено 2 чел.')).toBeVisible();
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.locator('#draft-bar')).toContainText('4 несохранённых изменения');
  await expect(node(page, 'Иса')).toBeVisible();

  await page.getByRole('button', { name: 'Посмотреть' }).click();
  await expect(page.locator('#draft-list li')).toHaveCount(4);
  await expect(page.locator('#draft-list')).toContainText('Добавлен ребёнок: Иса (родитель — Магомед)');
  await expect(page.locator('#draft-list')).toContainText('Удалена ветка: Алий — 2 чел.');

  await expect(node(other, 'Иса')).toHaveCount(0);
  await page.locator('#draft-bar').getByRole('button', { name: 'Сохранить' }).click();
  await page.getByLabel('Как вас подписать?').fill('Зайнаб');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.locator('#draft-bar')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Сохранено: 4 изменения. Теперь их видят все.');
  await expect(node(other, 'Иса')).toBeVisible({ timeout: 5000 });
  await expect(node(other, 'Расул')).toHaveCount(0);
});

test('draft survives reload', async ({ browser }) => {
  const s = await seed();
  const page = await openTree(browser, s.backend, s.e);
  await addChild(page, 'Патимат', 'Иса');
  await page.reload();
  await expect(page.locator('#draft-bar')).toContainText('1 несохранённое изменение');
  await expect(node(page, 'Иса')).toBeVisible();
});

test('conflict', async ({ browser }) => {
  const s = await seed();
  const a = await openTree(browser, s.backend, s.e);
  const b = await openTree(browser, s.backend, s.e);
  await select(a, 'Али');
  await a.getByRole('button', { name: 'Исправить' }).click();
  await a.getByLabel('Имя супруга или супруги').fill('Асият');
  await a.getByRole('button', { name: 'Применить' }).click();

  await select(b, 'Али');
  await b.getByRole('button', { name: 'Исправить' }).click();
  await b.getByLabel('Имя', { exact: true }).fill('Алий');
  await b.getByRole('button', { name: 'Применить' }).click();
  await b.locator('#draft-bar').getByRole('button', { name: 'Сохранить' }).click();
  await b.getByLabel('Как вас подписать?').fill('Зайнаб');
  await b.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(b.locator('#draft-bar')).toBeHidden();

  await a.locator('#draft-bar').getByRole('button', { name: 'Сохранить' }).click();
  await a.getByLabel('Как вас подписать?').fill('Расул');
  await a.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(a.locator('#conflicts')).toContainText('уже изменил(а) Зайнаб');
  await a.getByRole('button', { name: 'Убрать эти пункты' }).click();
  await expect(a.locator('#draft-bar')).toBeHidden();
});

test('search', async ({ browser }) => {
  const s = await seed();
  const page = await openTree(browser, s.backend, s.v);
  await page.getByRole('searchbox').fill('ХIасан');
  await expect(page.locator('#found')).toContainText('ХӀасан');
  await page.locator('#found button').first().click();
  await expect(page.locator('#panel h2')).toHaveText('ХӀасан');
  await expect(node(page, 'ХӀасан')).toHaveClass(/hl/);
});

test('no overlap', async ({ browser }) => {
  const backend = await createBackend();
  const t = await makeTree(backend.db, 'Родоначальник Длинноимённый');
  const ops = [];
  const add = (parent, name) => { const id = uid(); ops.push({ type: 'add_child', id, parent_id: parent, name, spouse: name.length % 2 ? 'жена Асият' : '' }); return id; };
  for (let i = 0; i < 4; i++) {
    const c = add(t.rootId, 'Сын номер ' + i + ' Абдурахман');
    for (let j = 0; j < 3; j++) {
      const g = add(c, 'Внук ' + i + j);
      for (let k = 0; k < 2; k++) add(g, 'Правнук ' + i + j + k + ' Абдулмуслим');
    }
  }
  await rpc(backend.db, 'save_changes', t.o, 'Создатель', 0, ops, false);
  const page = await openTree(browser, backend, t.v);
  await page.getByRole('button', { name: 'Раскрыть всё' }).click();
  const boxes = await page.locator('.node text.nm').evaluateAll(els => els.map(e => {
    const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, s: e.textContent };
  }));
  expect(boxes.length).toBe(1 + 4 + 12 + 24);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
    expect(overlap, `${a.s} / ${b.s}`).toBe(false);
  }
});

test('unknown token', async ({ page, context }) => {
  await installFakeApi(context, await createBackend());
  await page.goto('tree.html#t=abc');
  await expect(page.getByText('Древо не найдено. Проверьте, что ссылка скопирована целиком.')).toBeVisible();
});

test('spouse role buttons', async ({ browser }) => {
  const s = await seed();
  const page = await openTree(browser, s.backend, s.e);
  await select(page, 'Патимат');
  await page.getByRole('button', { name: 'Исправить' }).click();
  await expect(page.getByRole('button', { name: 'муж', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Имя супруга или супруги')).toHaveValue('Ахмед');

  await select(page, 'Расул');
  await page.getByRole('button', { name: 'Исправить' }).click();
  await expect(page.getByRole('button', { name: 'жена', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#panel')).toContainText('Выбрано по имени: «жена». Если неверно, переключите.');
  await page.getByRole('button', { name: 'муж', exact: true }).click();
  await page.getByRole('button', { name: 'жена', exact: true }).click();
  await page.getByLabel('Имя супруга или супруги').fill('Асият');
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(node(page, 'Расул')).toContainText('жена Асият');
});

test('collapse all', async ({ browser }) => {
  const s = await seed();
  const page = await openTree(browser, s.backend, s.v);
  await page.getByRole('button', { name: 'Раскрыть всё' }).click();
  await expect(page.locator('.node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Свернуть всё' }).click();
  // Остаются родоначальник и его дети; у свёрнутых веток виден счётчик скрытых.
  await expect(page.locator('.node')).toHaveCount(3);
  await expect(node(page, 'Али')).toContainText('+1');
  await page.getByRole('button', { name: 'Раскрыть всё' }).click();
  await expect(page.locator('.node')).toHaveCount(5);
});
