import { test, expect } from '@playwright/test';
import { randomUUID as uid } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createBackend, installFakeApi } from './fake-api.js';
import { rpc, makeTree } from '../sql/helpers.mjs';

test('layouts render 400 people', async ({ page }) => {
  await page.goto('index.html');
  await page.addScriptTag({ url: 'vendor/d3.min.js' });
  const results = await page.evaluate(async () => {
    const { renderPoster, DESIGNS, PAPER } = await import('/js/poster/layouts.js');
    // Синтетическое древо: 400 человек, до 7 поколений, вымышленные имена.
    const names = ['Али', 'МухӀамад', 'Патимат', 'Расул', 'Зайнаб', 'Хадижат', 'Абдулмуслим', 'Иса', 'Муса', 'Асият'];
    let n = 0;
    const make = depth => {
      const node = { id: 'p' + n, name: names[n % names.length] + ' ' + n, spouse: n % 3 ? '' : 'жена Асият', children: [] };
      n++;
      return node;
    };
    const root = make(0);
    const queue = [[root, 0]];
    while (n < 400) {
      const [p, d] = queue.shift();
      const kids = Math.min(400 - n, d < 2 ? 4 : 3);
      for (let i = 0; i < kids; i++) { const c = make(d + 1); p.children.push(c); queue.push([c, d + 1]); }
    }
    const out = [];
    for (const d of DESIGNS) for (const paper of ['A0', 'A4']) {
      const svg = renderPoster(root, { design: d.id, paper, title: 'Род Али', subtitle: 'проверка' });
      document.body.append(svg);
      const texts = [...svg.querySelectorAll('text.pn')];
      const outside = texts.filter(t => { const b = t.getBBox(); return !(b.width > 0); }).length;
      out.push({ design: d.id, paper, names: texts.length, viewBox: svg.getAttribute('viewBox'), want: `0 0 ${PAPER[paper][0]} ${PAPER[paper][1]}`, outside });
      svg.remove();
    }
    return out;
  });
  expect(results).toHaveLength(8);
  for (const r of results) {
    expect(r.names, `${r.design} ${r.paper}`).toBe(400);
    expect(r.viewBox).toBe(r.want);
    expect(r.outside).toBe(0);
  }
});

async function seed() {
  const backend = await createBackend();
  const t = await makeTree(backend.db, 'ХӀасан');
  const ali = uid();
  await rpc(backend.db, 'save_changes', t.o, 'Создатель', 0, [
    { type: 'add_child', id: ali, parent_id: t.rootId, name: 'Али', spouse: '' },
    { type: 'add_child', id: uid(), parent_id: ali, name: 'Расул', spouse: '' },
    { type: 'add_child', id: uid(), parent_id: t.rootId, name: 'Патимат', spouse: 'муж Ахмед' },
  ], false);
  return { backend, ...t };
}

test('poster follows what is on screen, without deleted people', async ({ page, context }) => {
  const s = await seed();
  await installFakeApi(context, s.backend);
  await page.goto('tree.html#t=' + s.e);
  await page.locator('text.nm >> text="Али"').click();
  await page.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  await page.getByRole('button', { name: 'Плакат PDF' }).click();
  const preview = page.locator('#poster-preview');
  await expect(preview.locator('text.pn')).toHaveCount(2);
  await expect(preview).not.toContainText('Али');
  await expect(preview).toContainText('Патимат');
});

test('download a fan poster on A3', async ({ page, context }) => {
  const s = await seed();
  await installFakeApi(context, s.backend);
  await page.goto('tree.html#t=' + s.v);
  await page.getByRole('button', { name: 'Плакат PDF' }).click();
  await page.getByRole('radio', { name: 'Круг' }).check();
  await page.getByRole('radio', { name: 'A3' }).check();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Скачать PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/_fan_A3\.pdf$/);
  const bytes = readFileSync(await download.path());
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  expect(bytes.includes(Buffer.from('/FontFile2'))).toBe(true);
  expect(bytes.includes(Buffer.from('PTSerif'))).toBe(true);
});

async function synthetic(page, count) {
  await page.goto('index.html');
  await page.addScriptTag({ url: 'vendor/d3.min.js' });
  return count;
}
const makeTreeFn = `(count) => {
  const names = ['Али', 'МухӀамад', 'Патимат', 'Расул', 'Зайнаб', 'Хадижат', 'Абдулмуслим', 'Иса', 'Муса', 'Асият'];
  let n = 0;
  const make = () => ({ id: 'p' + n, name: names[n % names.length] + ' ' + n, spouse: n++ % 3 ? '' : 'жена Асият', children: [] });
  const root = make(); const queue = [[root, 0]];
  while (n < count) { const [p, d] = queue.shift(); const k = Math.min(count - n, d < 2 ? 4 : 3);
    for (let i = 0; i < k; i++) { const c = make(); p.children.push(c); queue.push([c, d + 1]); } }
  return root;
}`;

test('topdown: names horizontal, black frames, nothing off the sheet', async ({ page }) => {
  await synthetic(page);
  const r = await page.evaluate(async src => {
    const { renderPoster, PAPER } = await import('/js/poster/layouts.js');
    const root = eval(src)(400);
    const out = [];
    for (const paper of ['A0', 'A4']) {
      const svg = renderPoster(root, { design: 'topdown', paper, title: 'Род Али' });
      document.body.append(svg);
      const [W, H] = PAPER[paper];
      const texts = [...svg.querySelectorAll('text.pn')];
      const rotated = texts.filter(t => /rotate/.test(t.getAttribute('transform') || '')).length;
      const ctm = svg.getScreenCTM().inverse();
      const off = texts.filter(t => {
        const b = t.getBoundingClientRect();
        const p1 = new DOMPoint(b.left, b.top).matrixTransform(ctm), p2 = new DOMPoint(b.right, b.bottom).matrixTransform(ctm);
        return p1.x < -0.01 || p1.y < -0.01 || p2.x > W + 0.01 || p2.y > H + 0.01;
      }).length;
      const strokes = [...new Set([...svg.querySelectorAll('rect.box')].map(x => x.getAttribute('stroke')))];
      out.push({ paper, names: texts.length, rotated, off, strokes, minFont: Number(svg.dataset.minFont) });
      svg.remove();
    }
    return out;
  }, makeTreeFn);
  for (const x of r) {
    expect(x.names).toBe(400);
    expect(x.rotated, x.paper).toBe(0);
    expect(x.off, x.paper).toBe(0);
    expect(x.strokes).toEqual(['#000000']);
  }
  // Горизонтальные подписи не должны стать мельче, чем были вертикальные: на A0 не меньше 2 мм.
  expect(r.find(x => x.paper === 'A0').minFont).toBeGreaterThan(2);
});

test('fan: colour palettes', async ({ page }) => {
  await synthetic(page);
  const r = await page.evaluate(async src => {
    const { renderPoster, FAN_PALETTES } = await import('/js/poster/layouts.js');
    const root = eval(src)(60);
    return FAN_PALETTES.map(p => {
      const svg = renderPoster(root, { design: 'fan', paper: 'A3', title: 'Т', palette: p.id });
      const fills = new Set([...svg.querySelectorAll('path.arc')].map(a => a.getAttribute('fill')));
      return { id: p.id, title: p.title, ok: [...fills].every(f => p.colors.includes(f)), n: fills.size };
    });
  }, makeTreeFn);
  expect(r.length).toBeGreaterThanOrEqual(4);
  for (const x of r) { expect(x.ok, x.id).toBe(true); expect(x.n).toBeGreaterThan(1); }
});

test('palette choice appears only for the fan', async ({ page, context }) => {
  const s = await seed();
  await installFakeApi(context, s.backend);
  await page.goto('tree.html#t=' + s.v);
  await page.getByRole('button', { name: 'Плакат PDF' }).click();
  await expect(page.getByRole('group', { name: 'Палитра' })).toBeHidden();
  await page.getByRole('radio', { name: 'Круг' }).check();
  await expect(page.getByRole('group', { name: 'Палитра' })).toBeVisible();
  await page.getByRole('radio', { name: 'Море' }).check();
  await expect(page.locator('#poster-preview path.arc').first()).toHaveAttribute('fill', /#/);
});
