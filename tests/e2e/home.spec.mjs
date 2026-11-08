import { test, expect } from '@playwright/test';
import { createBackend, installFakeApi } from './fake-api.js';

test.beforeEach(async ({ context }) => {
  await installFakeApi(context, await createBackend());
});

test('create a tree and get three links', async ({ page }) => {
  await page.goto('index.html');
  await page.getByLabel('Имя родоначальника').fill('Магомед');
  await expect(page.locator('#sprig-root')).toHaveText('Магомед');
  await expect(page.getByLabel('Название древа')).toHaveValue('Род Магомед');
  await page.getByLabel('Название древа').fill('Род Магомеда');
  await page.getByRole('button', { name: 'Создать древо' }).click();
  await expect(page.getByText('Сохраните эту ссылку — восстановить её нельзя')).toBeVisible();
  const links = page.locator('.share-link input');
  await expect(links).toHaveCount(3);
  for (const v of await links.evaluateAll(els => els.map(e => e.value))) expect(v).toContain('tree.html#t=');
  await expect(page.getByRole('link', { name: 'Открыть древо' })).toHaveAttribute('href', /tree\.html#t=/);
  // Древо появилось в «Мои древа» на главной.
  await page.goto('index.html');
  await expect(page.getByRole('link', { name: 'Род Магомеда' })).toBeVisible();
});

test('empty name is rejected', async ({ page }) => {
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Создать древо' }).click();
  await expect(page.getByText('Введите имя')).toBeVisible();
});

test('example link and no horizontal scroll', async ({ page }) => {
  await page.goto('index.html');
  await expect(page.getByRole('link', { name: /Посмотреть пример/ })).toHaveAttribute('href', 'tree.html#t=romanovy');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
