import { test, expect } from '@playwright/test';
import { randomUUID as uid } from 'node:crypto';
import { createBackend, installFakeApi } from './fake-api.js';
import { rpc, makeTree } from '../sql/helpers.mjs';

async function seed() {
  const backend = await createBackend();
  const t = await makeTree(backend.db);
  const ali = uid(), ras = uid();
  await rpc(backend.db, 'save_changes', t.o, 'Создатель', 0, [
    { type: 'add_child', id: ali, parent_id: t.rootId, name: 'Али', spouse: '' },
    { type: 'add_child', id: ras, parent_id: ali, name: 'Расул', spouse: '' },
    { type: 'add_child', id: uid(), parent_id: ras, name: 'Муса', spouse: '' },
    { type: 'add_child', id: uid(), parent_id: t.rootId, name: 'Патимат', spouse: '' },
  ], false);
  return { backend, ...t, ali, ras };
}
async function open(browser, backend, token) {
  const context = await browser.newContext();
  await installFakeApi(context, backend);
  const page = await context.newPage();
  await page.goto('tree.html#t=' + token);
  await expect(page.locator('.node').first()).toBeVisible();
  return page;
}
const node = (page, name) => page.locator('.node', { has: page.locator(`text.nm >> text="${name}"`) });

test('edit sees history without revert buttons', async ({ browser }) => {
  const s = await seed();
  const page = await open(browser, s.backend, s.e);
  await page.getByRole('button', { name: 'История' }).click();
  const dlg = page.locator('#history');
  await expect(dlg).toContainText('Создатель');
  await expect(dlg).toContainText('Добавлен ребёнок: Али (родитель — Магомед)');
  await expect(dlg.getByRole('button', { name: /Откатить/ })).toHaveCount(0);
  await expect(dlg.getByRole('tab', { name: 'Удалённое' })).toHaveCount(0);
});

test('owner restores deleted branch', async ({ browser }) => {
  const s = await seed();
  await rpc(s.backend.db, 'save_changes', s.e, 'Зайнаб', 1, [{ type: 'delete', person_id: s.ali }], false);
  const page = await open(browser, s.backend, s.o);
  await expect(node(page, 'Али')).toHaveCount(0);
  await page.getByRole('button', { name: 'История' }).click();
  await page.getByRole('tab', { name: 'Удалённое' }).click();
  await expect(page.locator('#history')).toContainText('Али — 3 чел.');
  await page.locator('#history').getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.locator('#history')).toContainText('Удалённого нет');
  await page.locator('#history').getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'Раскрыть всё' }).click();
  for (const n of ['Али', 'Расул', 'Муса']) await expect(node(page, n)).toHaveCount(1);
});

test('owner reverts single edit', async ({ browser }) => {
  const s = await seed();
  await rpc(s.backend.db, 'save_changes', s.e, 'Зайнаб', 1, [
    { type: 'update', person_id: s.ali, name: 'Алий' },
    { type: 'add_child', id: uid(), parent_id: s.rootId, name: 'Иса', spouse: '' },
  ], false);
  const page = await open(browser, s.backend, s.o);
  await page.getByRole('button', { name: 'История' }).click();
  const line = page.locator('#history li', { hasText: 'Исправлено имя: Али → Алий' });
  await line.getByRole('button', { name: 'Откатить' }).click();
  await expect(line).toContainText('откачено');
  await page.locator('#history').getByRole('button', { name: 'Закрыть' }).click();
  await expect(node(page, 'Али')).toHaveCount(1);
  await expect(node(page, 'Иса')).toHaveCount(1);
});

test('revert warns when the person changed later', async ({ browser }) => {
  const s = await seed();
  await rpc(s.backend.db, 'save_changes', s.e, 'Зайнаб', 1, [{ type: 'update', person_id: s.ali, name: 'Алий' }], false);
  await rpc(s.backend.db, 'save_changes', s.e, 'Расул', 2, [{ type: 'update', person_id: s.ali, spouse: 'жена Асият' }], false);
  const page = await open(browser, s.backend, s.o);
  await page.getByRole('button', { name: 'История' }).click();
  const line = page.locator('#history li', { hasText: 'Исправлено имя: Али → Алий' });
  page.once('dialog', d => { expect(d.message()).toContain('После этого Алий ещё менял(а) Расул'); d.accept(); });
  await line.getByRole('button', { name: 'Откатить' }).click();
  await expect(line).toContainText('откачено');
});
