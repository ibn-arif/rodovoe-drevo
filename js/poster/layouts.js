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

// ── Круг: предок в центре, поколения — кольца ───────────────────────────
function fan(g, root, area, theme) {
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
    const color = theme.ring[(branchIndex.get(branchOf(d)) ?? 0) % theme.ring.length];
    const path = arc({ innerRadius: inner, outerRadius: outer, startAngle: d.x0, endAngle: d.x1, padAngle: 0 });
    el('path', { d: path, transform: `translate(${fmt(cx)} ${fmt(cy)})`, fill: color, 'fill-opacity': fmt(Math.max(0.18, 0.75 - d.depth * 0.09)),
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

export function renderPoster(rootNode, { design = 'classic', paper = 'A0', title = '', subtitle = '' } = {}) {
  const [W, H] = PAPER[paper];
  const theme = THEMES[design];
  const svg = el('svg', { xmlns: NS, viewBox: `0 0 ${W} ${H}`, width: `${W}mm`, height: `${H}mm` });
  el('rect', { x: 0, y: 0, width: W, height: H, fill: theme.bg }, svg);
  const m = W * 0.045;
  if (design === 'gold') {
    el('rect', { x: m * 0.5, y: m * 0.5, width: W - m, height: H - m, fill: 'none', stroke: theme.frame, 'stroke-width': W * 0.0016 }, svg);
    el('rect', { x: m * 0.68, y: m * 0.68, width: W - m * 1.36, height: H - m * 1.36, fill: 'none', stroke: theme.frame, 'stroke-width': W * 0.0007, 'stroke-dasharray': `${W * 0.004} ${W * 0.003}` }, svg);
  } else if (design === 'classic') {
    el('rect', { x: m * 0.55, y: m * 0.55, width: W - m * 1.1, height: H - m * 1.1, fill: 'none', stroke: theme.frame, 'stroke-width': W * 0.0017 }, svg);
  }
  const titleSize = W * 0.05;
  el('text', { x: W / 2, y: m + titleSize, 'font-family': FONT, 'font-size': fmt(titleSize), 'font-weight': 700, fill: theme.ink, 'text-anchor': 'middle' }, svg).textContent = title;
  let top = m + titleSize * 1.45;
  if (subtitle) {
    const ss = W * 0.015;
    el('text', { x: W / 2, y: fmt(top + ss * 0.4), 'font-family': FONT, 'font-size': fmt(ss), 'font-style': 'italic', fill: theme.muted, 'text-anchor': 'middle' }, svg).textContent = subtitle;
    top += ss * 1.6;
  }
  const area = { x: m, y: top + m * 0.4, w: W - m * 2, h: H - top - m * 1.6 };
  const g = el('g', {}, svg);
  const root = d3.hierarchy(rootNode, d => d.children && d.children.length ? d.children : null);
  const minFont = design === 'classic' ? classic(g, root, area, theme)
    : design === 'topdown' ? vertical(g, root, area, theme, { up: false, boxes: true })
    : design === 'gold' ? vertical(g, root, area, theme, { up: true, boxes: false })
    : fan(g, root, area, theme);
  svg.dataset.minFont = String(minFont);
  if (minFont < MIN_FONT_MM) svg.dataset.tiny = '1';
  return svg;
}
