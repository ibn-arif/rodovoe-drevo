// Плакат: четыре раскладки древа в SVG. viewBox — в миллиметрах листа, поэтому PDF получается векторным.
// Каждое имя — <text class="pn">. Цвета и шрифты заданы атрибутами (не CSS), чтобы их понял svg2pdf.
/* global d3 */

export const PAPER = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };
export const DESIGNS = [
  { id: 'classic', title: 'Классика' },
  { id: 'topdown', title: 'Сверху вниз' },
  { id: 'fan', title: 'Круг' },
  { id: 'gold', title: 'Тёмный с золотом' },
];
export const MIN_FONT_MM = 1.2;
// Лента для рулонной печати (плоттер): высота 84 см, длина по древу.
export const ROLL = { height: 841, maxWidth: 5000, font: 4 };
export const FAN_PALETTES = [
  { id: 'earth', title: 'Земля', colors: ['#8B2D3B', '#C9A35B', '#5E7F6E', '#6F5E96', '#3F6E8C', '#B8693A'] },
  { id: 'garden', title: 'Сад', colors: ['#2F6B45', '#7FA650', '#A7C4A0', '#3E7C6E', '#C2B04A', '#5C8A3A'] },
  { id: 'sea', title: 'Море', colors: ['#1F4E79', '#2E86AB', '#7FB7D6', '#3D5A80', '#48A9A6', '#98C1D9'] },
  { id: 'sunset', title: 'Закат', colors: ['#B23A48', '#E07A3F', '#F2B134', '#8C3B5A', '#D95D39', '#F28F3B'] },
  { id: 'graphite', title: 'Графит', colors: ['#2B2B2B', '#5A5A5A', '#8A8A8A', '#444444', '#6E6E6E', '#A0A0A0'] },
];

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'PT Serif';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
const THEMES = {
  classic: { bg: '#F4F5F1', ink: '#1E2624', muted: '#5D6864', accent: '#8B2D3B', line: '#8E9A94', frame: '#8B2D3B' },
  topdown: { bg: '#FBF8F1', ink: '#3B2F22', muted: '#7A6A55', accent: '#8B5E1A', line: '#B49A6A', frame: '#B49A6A', box: '#FFFFFF' },
  fan: { bg: '#F2F1EC', ink: '#1E2624', muted: '#5D6864', accent: '#8B2D3B', line: '#FFFFFF', frame: '#C3CAC4',
    ring: ['#8B2D3B', '#C9A35B', '#5E7F6E', '#6F5E96', '#3F6E8C', '#B8693A'] },
  gold: { bg: '#1C2422', ink: '#E9D9B0', muted: '#B9A97E', accent: '#E9D9B0', line: '#C9A35B', frame: '#C9A35B' },
};

let ctx;
function measure(text, size, weight = 400, style = 'normal') {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${style} ${weight} ${size}px "${FONT}", Georgia, serif`;
  return ctx.measureText(text).width;
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.append(e);
  return e;
}
const fmt = n => Math.round(n * 1000) / 1000;

// Имя и (мельче) подпись о супруге в одном <text class="pn">.
function nameText(parent, d, { x, y, size, theme, weight = 400, anchor = 'start', rotate = 0, spouse = true }) {
  const t = el('text', { class: 'pn', x: fmt(x), y: fmt(y), 'font-family': FONT, 'font-size': fmt(size), 'font-weight': weight,
    fill: theme.ink, 'text-anchor': anchor, 'dominant-baseline': 'middle',
    transform: rotate ? `rotate(${fmt(rotate)} ${fmt(x)} ${fmt(y)})` : undefined }, parent);
  t.append(d.data.name);
  if (spouse && d.data.spouse) {
    // Отступ через dx: пробелы в начале строки PDF схлопывает. Жирного курсива нет — подпись всегда обычная.
    const s = el('tspan', { dx: fmt(size * 0.45), 'font-size': fmt(size * 0.72), 'font-style': 'italic', 'font-weight': 400, fill: theme.muted }, t);
    s.textContent = d.data.spouse;
  }
  return t;
}
function labelWidth(d, size, weight, spouse = true) {
  let w = measure(d.data.name, size, weight);
  if (spouse && d.data.spouse) w += size * 0.45 + measure(d.data.spouse, size * 0.72, 400, 'italic');
  return w;
}

// ── Классика: слева направо, столбцы — поколения ────────────────────────
function classic(g, root, area, theme) {
  const FS = 10, ROW = FS * 1.45, GAP = FS * 3.2, HEAD = FS * 3;
  const weight = d => d.depth < 2 ? 700 : 400;
  const size = d => d.depth < 2 ? FS * 1.25 : FS;
  d3.tree().nodeSize([ROW, 1]).separation((a, b) => a.parent === b.parent ? 1 : 1.3)(root);
  const nodes = root.descendants();
  const wmax = [], colX = [0];
  nodes.forEach(d => { wmax[d.depth] = Math.max(wmax[d.depth] || 0, labelWidth(d, size(d), weight(d)) + FS * 0.9); });
  for (let i = 1; i < wmax.length; i++) colX[i] = colX[i - 1] + wmax[i - 1] + GAP;
  const [x0, x1] = d3.extent(nodes, d => d.x);
  const width = colX[colX.length - 1] + wmax[wmax.length - 1];
  const height = x1 - x0 + ROW + HEAD;
  const s = Math.min(area.w / width, area.h / height);
  const tg = el('g', { transform: `translate(${fmt(area.x + (area.w - width * s) / 2)} ${fmt(area.y + (area.h - height * s) / 2)}) scale(${fmt(s)})` }, g);
  const Y = d => d.x - x0 + HEAD + ROW / 2;

  wmax.forEach((_, i) => {
    el('text', { x: fmt(colX[i]), y: FS, 'font-family': FONT, 'font-size': FS * 1.1, 'font-weight': 700, fill: theme.accent }, tg).textContent = ROMAN[i] ?? String(i + 1);
    el('line', { x1: fmt(colX[i]), x2: fmt(colX[i]), y1: FS * 1.8, y2: fmt(height), stroke: theme.line, 'stroke-width': 0.3, 'stroke-dasharray': '1 3', opacity: 0.6 }, tg);
  });
  for (const l of root.links()) {
    const p = l.source, c = l.target;
    const sx = colX[p.depth] + labelWidth(p, size(p), weight(p)) + FS * 0.9;
    const ex = colX[p.depth] + wmax[p.depth];
    const tx = colX[c.depth] - FS * 0.35, mx = ex + (tx - ex) * 0.5;
    el('path', { d: `M${fmt(sx)},${fmt(Y(p))} L${fmt(ex)},${fmt(Y(p))} C${fmt(mx)},${fmt(Y(p))} ${fmt(mx)},${fmt(Y(c))} ${fmt(tx)},${fmt(Y(c))}`,
      fill: 'none', stroke: theme.line, 'stroke-width': 0.6 }, tg);
  }
  for (const d of nodes) {
    el('circle', { cx: fmt(colX[d.depth]), cy: fmt(Y(d)), r: FS * 0.22, fill: d.children ? '#FFFFFF' : theme.line,
      stroke: d.children ? theme.accent : theme.line, 'stroke-width': 0.6 }, tg);
    nameText(tg, d, { x: colX[d.depth] + FS * 0.6, y: Y(d), size: size(d), theme, weight: weight(d) });
  }
  return FS * s;
}

// ── Вертикальные: сверху вниз (topdown) и снизу вверх (gold) ─────────────
function vertical(g, root, area, theme, { up, boxes }) {
  const FS = 10, PAD = FS * 0.45, GAPY = FS * 2.6;
  const leaves = root.leaves().length;
  const rotated = d => d.depth > 0 && leaves > 8;           // при многих людях подписи встают вертикально
  const weight = d => d.depth < 2 ? 700 : 400;
  const size = d => d.depth === 0 ? FS * 1.3 : FS;
  const lw = d => labelWidth(d, size(d), weight(d), !rotated(d) || true);
  const thick = d => rotated(d) ? size(d) * 1.35 : lw(d) + PAD * 2;    // ширина узла по горизонтали
  const tall = d => rotated(d) ? lw(d) + PAD * 2 : size(d) * 1.8;      // высота узла по вертикали

  d3.tree().nodeSize([1, 1]).separation((a, b) => (thick(a) + thick(b)) / 2 + FS * (a.parent === b.parent ? 0.35 : 0.9))(root);
  const nodes = root.descendants();
  const hmax = [], lvl = [0];
  nodes.forEach(d => { hmax[d.depth] = Math.max(hmax[d.depth] || 0, tall(d)); });
  for (let i = 1; i < hmax.length; i++) lvl[i] = lvl[i - 1] + hmax[i - 1] + GAPY;
  const [x0, x1] = d3.extent(nodes, d => d.x);
  const left = x0 - d3.max(nodes.filter(d => d.x === x0), thick) / 2;
  const right = x1 + d3.max(nodes.filter(d => d.x === x1), thick) / 2;
  const width = right - left, height = lvl[lvl.length - 1] + hmax[hmax.length - 1];
  const s = Math.min(area.w / width, area.h / height);
  const tg = el('g', { transform: `translate(${fmt(area.x + (area.w - width * s) / 2)} ${fmt(area.y + (area.h - height * s) / 2)}) scale(${fmt(s)})` }, g);
  const X = d => d.x - left;
  // Верх и низ узла в координатах листа (для gold древо растёт снизу вверх).
  const top = d => up ? height - lvl[d.depth] - tall(d) : lvl[d.depth];
  const bottom = d => top(d) + tall(d);

  for (const l of root.links()) {
    const p = l.source, c = l.target;
    if (up) {
      const y1 = top(p), y2 = bottom(c), my = (y1 + y2) / 2;
      el('path', { d: `M${fmt(X(p))},${fmt(y1)} C${fmt(X(p))},${fmt(my)} ${fmt(X(c))},${fmt(my)} ${fmt(X(c))},${fmt(y2)}`,
        fill: 'none', stroke: theme.line, 'stroke-width': 0.7 }, tg);
    } else {
      const y1 = bottom(p), y2 = top(c), my = y1 + GAPY / 2;
      el('path', { d: `M${fmt(X(p))},${fmt(y1)} V${fmt(my)} H${fmt(X(c))} V${fmt(y2)}`, fill: 'none', stroke: theme.line, 'stroke-width': 0.6 }, tg);
    }
  }
  for (const d of nodes) {
    const cx = X(d), cy = (top(d) + bottom(d)) / 2;
    if (boxes) {
      el('rect', { x: fmt(cx - thick(d) / 2), y: fmt(top(d)), width: fmt(thick(d)), height: fmt(tall(d)), rx: FS * 0.3,
        fill: theme.box, stroke: theme.line, 'stroke-width': 0.5 }, tg);
    } else {
      el('circle', { cx: fmt(cx), cy: fmt(up ? bottom(d) : top(d)), r: FS * 0.22, fill: theme.line }, tg);
    }
    nameText(tg, d, { x: cx, y: cy, size: size(d), theme, weight: weight(d), anchor: 'middle', rotate: rotated(d) ? (up ? -90 : 90) : 0 });
  }
  return FS * s;
}

// ── Сверху вниз: строго классическая схема ──────────────────────────────
// Каждый человек — в скруглённой чёрной рамке; родитель по центру над детьми, все дети в ряд ниже,
// поколение за поколением. Линии со скруглёнными углами. Подпись в рамке — в несколько строк.
const TD = { FS: 10, PAD: 6, GAP: 8, FAMILY_GAP: 18, LEVEL: 30, R: 6 };

function boxLines(d) {
  const FS = TD.FS, size = d.depth === 0 ? FS * 1.3 : FS, weight = d.depth < 2 ? 700 : 400;
  const m = /^(.*?)\s*(\([^()]*\))\s*$/.exec(d.data.name);
  const name = m ? m[1] : d.data.name, years = m ? m[2] : '';
  const words = name.split(/\s+/);
  const nameLines = words.length > 1 && name.length > 12 ? [words[0], words.slice(1).join(' ')] : [name];
  const lines = nameLines.map(t => ({ t, size, weight, main: true }));
  if (years) lines.push({ t: years, size: size * 0.8, weight: 400 });
  if (d.data.spouse) lines.push({ t: d.data.spouse, size: size * 0.72, weight: 400, italic: true });
  return lines;
}
const lineW = l => measure(l.t, l.size, l.weight, l.italic ? 'italic' : 'normal');

function topdownMeasure(root) {
  const { PAD, GAP, FAMILY_GAP, LEVEL } = TD;
  const nodes = root.descendants();
  const lines = new Map(nodes.map(d => [d, boxLines(d)]));
  const bw = new Map(nodes.map(d => [d, Math.max(...lines.get(d).map(lineW)) + PAD * 2]));
  const bh = new Map(nodes.map(d => [d, lines.get(d).reduce((h, l) => h + l.size * 1.25, 0) + PAD * 1.4]));
  // Высота ряда — по самой высокой рамке поколения, чтобы ряды шли ровно.
  const rowH = [];
  nodes.forEach(d => { rowH[d.depth] = Math.max(rowH[d.depth] || 0, bh.get(d)); });
  const rowY = [0];
  for (let i = 1; i < rowH.length; i++) rowY[i] = rowY[i - 1] + rowH[i - 1] + LEVEL;
  const dim = new Map();
  for (const d of [...nodes].reverse()) {
    const w0 = bw.get(d);
    if (!d.children) { dim.set(d, { w: w0 }); continue; }
    const gap = d.children.some(c => c.children) ? FAMILY_GAP : GAP;
    const row = d.children.reduce((sum, c) => sum + dim.get(c).w, 0) + (d.children.length - 1) * gap;
    dim.set(d, { w: Math.max(w0, row), row, gap });
  }
  const h = rowY.at(-1) + rowH.at(-1);
  return { nodes, bw, bh, lines, dim, rowY, rowH, w: dim.get(root).w, h };
}

function topdown(g, root, area, theme, m = topdownMeasure(root)) {
  const { FS, LEVEL, R } = TD;
  const { nodes, bw, bh, lines, dim, rowY, rowH, w: width, h: height } = m;
  const s = Math.min(area.w / width, area.h / height);
  const tg = el('g', { transform: `translate(${fmt(area.x + (area.w - width * s) / 2)} ${fmt(area.y + (area.h - height * s) / 2)}) scale(${fmt(s)})` }, g);
  const cx = new Map();
  (function place(d, x) {
    const dm = dim.get(d);
    if (!d.children) { cx.set(d, x + dm.w / 2); return; }
    let sx = x + (dm.w - dm.row) / 2;
    for (const c of d.children) { place(c, sx); sx += dim.get(c).w + dm.gap; }
    const mid = (cx.get(d.children[0]) + cx.get(d.children.at(-1))) / 2, half = bw.get(d) / 2;
    cx.set(d, Math.min(Math.max(mid, x + half), x + dm.w - half));
  })(root, 0);
  // У всех рамок поколения одна высота и ровный верх, как на классической схеме.
  const top = d => rowY[d.depth];
  const boxH = d => rowH[d.depth];

  const line = { fill: 'none', stroke: '#000000', 'stroke-width': 0.6, 'stroke-linecap': 'round' };
  for (const d of nodes) {
    if (!d.children) continue;
    const px = cx.get(d), py = top(d) + boxH(d), my = rowY[d.depth] + rowH[d.depth] + LEVEL / 2;
    for (const c of d.children) {
      const x = cx.get(c), cy = top(c), dx = x - px, r = Math.min(R, Math.abs(dx) / 2);
      if (Math.abs(dx) < 0.5) { el('path', { ...line, d: `M${fmt(px)},${fmt(py)} V${fmt(cy)}` }, tg); continue; }
      const sgn = Math.sign(dx);
      el('path', { ...line, d: `M${fmt(px)},${fmt(py)} V${fmt(my - r)} Q${fmt(px)},${fmt(my)} ${fmt(px + sgn * r)},${fmt(my)}`
        + ` H${fmt(x - sgn * r)} Q${fmt(x)},${fmt(my)} ${fmt(x)},${fmt(my + r)} V${fmt(cy)}` }, tg);
    }
  }
  for (const d of nodes) {
    const x = cx.get(d), w = bw.get(d), h = boxH(d), y = top(d);
    el('rect', { class: 'box', 'data-id': d.data.id, x: fmt(x - w / 2), y: fmt(y), width: fmt(w), height: fmt(h), rx: FS * 0.9,
      fill: '#FFFFFF', stroke: '#000000', 'stroke-width': 0.7 }, tg);
    const ls = lines.get(d);
    // Текст по центру рамки по высоте.
    const t = el('text', { class: 'pn', x: fmt(x), y: fmt(y + (h - bh.get(d)) / 2 + TD.PAD * 0.7), 'font-family': FONT, 'text-anchor': 'middle', fill: theme.ink }, tg);
    ls.forEach((l, i) => {
      el('tspan', { x: fmt(x), dy: fmt(l.size * (i === 0 ? 1 : 1.25)), 'font-size': fmt(l.size), 'font-weight': l.weight,
        'font-style': l.italic ? 'italic' : undefined, fill: l.main ? theme.ink : theme.muted }, t).textContent = l.t;
    });
  }
  return FS * s;
}

// ── Круг: предок в центре, поколения — кольца ───────────────────────────
function fan(g, root, area, theme, palette = 'earth') {
  const ring = (FAN_PALETTES.find(p => p.id === palette) ?? FAN_PALETTES[0]).colors;
  const R = Math.min(area.w, area.h) / 2, cx = area.x + area.w / 2, cy = area.y + area.h / 2;
  const maxDepth = Math.max(1, root.height);
  const r0 = R * 0.13, rw = (R - r0) / maxDepth;
  root.count();
  d3.partition().size([2 * Math.PI, maxDepth + 1])(root);
  const arc = d3.arc();
  const branchOf = d => d.ancestors().find(a => a.depth === 1);
  const branchIndex = new Map((root.children || []).map((c, i) => [c, i]));
  let minFont = Infinity;

  el('circle', { cx: fmt(cx), cy: fmt(cy), r: fmt(r0), fill: theme.accent }, g);
  const rootSize = Math.min(r0 * 0.38, (r0 * 1.7) / Math.max(0.01, measure(root.data.name, 1, 700)));
  minFont = Math.min(minFont, rootSize);
  el('text', { class: 'pn', x: fmt(cx), y: fmt(cy), 'font-family': FONT, 'font-size': fmt(rootSize), 'font-weight': 700, fill: '#FFFFFF',
    'text-anchor': 'middle', 'dominant-baseline': 'middle' }, g).textContent = root.data.name;

  for (const d of root.descendants().slice(1)) {
    const inner = r0 + (d.depth - 1) * rw, outer = inner + rw;
    const color = ring[(branchIndex.get(branchOf(d)) ?? 0) % ring.length];
    const path = arc({ innerRadius: inner, outerRadius: outer, startAngle: d.x0, endAngle: d.x1, padAngle: 0 });
    el('path', { class: 'arc', d: path, transform: `translate(${fmt(cx)} ${fmt(cy)})`, fill: color, 'fill-opacity': fmt(Math.max(0.18, 0.75 - d.depth * 0.09)),
      stroke: theme.line, 'stroke-width': fmt(Math.max(0.15, R * 0.0012)) }, g);
    const a = (d.x0 + d.x1) / 2, rm = (inner + outer) / 2;
    const arcLen = (d.x1 - d.x0) * rm;
    const weight = d.depth === 1 ? 700 : 400;
    const size = Math.max(0.05, Math.min(rw * 0.86 / Math.max(0.01, measure(d.data.name, 1, weight)), arcLen * 0.72, rw * 0.28));
    minFont = Math.min(minFont, size);
    let deg = a * 180 / Math.PI - 90;
    if (a > Math.PI) deg += 180;
    const x = cx + rm * Math.sin(a), y = cy - rm * Math.cos(a);
    el('text', { class: 'pn', x: fmt(x), y: fmt(y), 'font-family': FONT, 'font-size': fmt(size), 'font-weight': weight,
      fill: theme.ink, 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: `rotate(${fmt(deg)} ${fmt(x)} ${fmt(y)})` }, g).textContent = d.data.name;
  }
  return minFont;
}

export function renderPoster(rootNode, { design = 'classic', paper = 'A0', title = '', subtitle = '', palette = 'earth' } = {}) {
  const root = d3.hierarchy(rootNode, d => d.children && d.children.length ? d.children : null);
  const tdm = design === 'topdown' ? topdownMeasure(root) : null;
  let [W, H] = PAPER[paper] ?? PAPER.A0;
  if (tdm && tdm.w > tdm.h) [W, H] = [H, W];   // широкая схема — альбомный лист
  // Поля, заголовок и подзаголовок считаются от короткой стороны листа.
  const U = Math.min(W, H), m = U * 0.045, titleSize = U * 0.05, ss = U * 0.015;
  const headH = m + titleSize * 1.45 + (subtitle ? ss * 1.6 : 0);
  if (paper === 'ROLL' && tdm) {
    // Лента: высота 84 см, длина такая, чтобы имена были около 4 мм (не короче A0 и не длиннее 5 м).
    H = ROLL.height;
    const areaH = H - headH - m * 2;
    const scale = Math.min(ROLL.font / TD.FS, areaH / tdm.h);
    W = Math.round(Math.min(ROLL.maxWidth, Math.max(PAPER.A0[1], tdm.w * scale + m * 2)));
  }
  const theme = THEMES[design];
  const svg = el('svg', { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: `${W}mm`, height: `${H}mm` });
  el('rect', { x: 0, y: 0, width: W, height: H, fill: theme.bg }, svg);
  if (design === 'gold') {
    el('rect', { x: m * 0.5, y: m * 0.5, width: W - m, height: H - m, fill: 'none', stroke: theme.frame, 'stroke-width': U * 0.0016 }, svg);
    el('rect', { x: m * 0.68, y: m * 0.68, width: W - m * 1.36, height: H - m * 1.36, fill: 'none', stroke: theme.frame, 'stroke-width': U * 0.0007, 'stroke-dasharray': `${U * 0.004} ${U * 0.003}` }, svg);
  } else if (design === 'classic') {
    el('rect', { x: m * 0.55, y: m * 0.55, width: W - m * 1.1, height: H - m * 1.1, fill: 'none', stroke: theme.frame, 'stroke-width': U * 0.0017 }, svg);
  }
  el('text', { x: W / 2, y: m + titleSize, 'font-family': FONT, 'font-size': fmt(titleSize), 'font-weight': 700, fill: theme.ink, 'text-anchor': 'middle' }, svg).textContent = title;
  let top = m + titleSize * 1.45;
  if (subtitle) {
    el('text', { x: W / 2, y: fmt(top + ss * 0.4), 'font-family': FONT, 'font-size': fmt(ss), 'font-style': 'italic', fill: theme.muted, 'text-anchor': 'middle' }, svg).textContent = subtitle;
    top += ss * 1.6;
  }
  const area = { x: m, y: top + m * 0.4, w: W - m * 2, h: H - top - m * 1.6 };
  const g = el('g', {}, svg);
  const minFont = design === 'classic' ? classic(g, root, area, theme)
    : design === 'topdown' ? topdown(g, root, area, theme, tdm)
    : design === 'gold' ? vertical(g, root, area, theme, { up: true, boxes: false })
    : fan(g, root, area, theme, palette);
  svg.dataset.minFont = String(minFont);
  if (minFont < MIN_FONT_MM) svg.dataset.tiny = '1';
  return svg;
}
