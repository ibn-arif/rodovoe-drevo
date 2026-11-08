// d3-древо слева направо. Перенесено со страницы исходного проекта:
// ширина столбца — по самой длинной подписи, линии начинаются сразу после имени родителя.
/* global d3 */
import { norm } from './names.js';

const SERIF = '"PT Serif",Georgia,"Times New Roman",serif';
const SANS = '"PT Sans","Segoe UI",Roboto,Arial,sans-serif';
const TOP_DEPTH = 2;      // первые поколения — крупнее
const OPEN_DEPTH = 3;     // сколько поколений раскрыто при открытии

const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const mctx = document.createElement('canvas').getContext('2d');
const tw = (text, font) => { mctx.font = font; return mctx.measureText(text).width; };

export function createTreeView(stage, { onSelect, coveredBottom = () => 0 }) {
  const narrow = () => stage.clientWidth < 700;
  const COL = () => narrow() ? 170 : 210;
  const ROW = () => narrow() ? 36 : 32;

  const svg = d3.select(stage).append('svg').attr('role', 'tree').attr('aria-label', 'Родовое древо');
  const g = svg.append('g');
  const gLinks = g.append('g').attr('aria-hidden', 'true');
  const gMar = g.append('g').attr('aria-hidden', 'true');
  const gNodes = g.append('g');
  const zoom = d3.zoom().scaleExtent([0.2, 2.5]).on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom).on('dblclick.zoom', null);
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const open = new Set();
  let prev = new Map();   // где узлы стояли до перерисовки: новые ветки вырастают из родителя
  const DUR = 280;
  let known = new Set();
  let root = null, data = null, opts = { query: '', selectedId: null, marriages: [] };

  const spousesOf = id => opts.marriages.flatMap(m => m.a_id === id ? [m.b_id] : m.b_id === id ? [m.a_id] : []);
  const byId = id => all().find(d => d.data.id === id);
  function all() {
    const out = [];
    (function w(d) { out.push(d); (d._kids || []).forEach(w); })(root);
    return out;
  }
  const countDesc = d => (d._kids || []).reduce((n, k) => n + 1 + countDesc(k), 0);

  function labelWidth(d) {
    let w = 13 + tw(d.data.name, (d.depth < TOP_DEPTH ? '700 18px ' : '16px ') + SERIF);
    const sps = spousesOf(d.data.id);
    if (d.data.spouse && !sps.length) w += tw('  ' + clip(d.data.spouse, 22), '13px ' + SANS);
    if (d._kids && !d.children) w += tw('  +' + countDesc(d), '700 13px ' + SANS);
    sps.forEach(id => { const s = byId(id); if (s) w += tw('  ⚭ ' + s.data.name, '13px ' + SANS); });
    return w;
  }

  function hierarchy() {
    root = d3.hierarchy(data, d => d.children);
    root.descendants().forEach(d => {
      // Новые узлы: первые поколения раскрыты, дальше — свёрнуто.
      if (!known.has(d.data.id) && d.depth < OPEN_DEPTH) open.add(d.data.id);
      d._kids = d.children || null;
      d.children = d._kids && open.has(d.data.id) ? d._kids : null;
    });
    known = new Set(root.descendants().map(d => d.data.id));
  }

  function draw() {
    d3.tree().nodeSize([ROW(), COL()]).separation((a, b) => a.parent === b.parent ? 1 : 1.35)(root);
    const nodes = root.descendants(), links = root.links();
    const colX = [0], wmax = [];
    nodes.forEach(d => { wmax[d.depth] = Math.max(wmax[d.depth] || 0, labelWidth(d)); });
    for (let i = 1; i < wmax.length; i++) colX[i] = colX[i - 1] + Math.max(COL(), (wmax[i - 1] || 0) + (narrow() ? 70 : 100));
    nodes.forEach(d => { d.y = colX[d.depth]; });

    const dur = reduce() || !prev.size ? 0 : DUR;
    const ease = d3.easeCubicOut;
    const vis = new Map(nodes.map(d => [d.data.id, d]));
    // Ближайший видимый предок (куда сворачивается исчезающая ветка) и его прежнее место (откуда растёт новая).
    const anchorNew = d => { for (let a = d.parent; a; a = a.parent) { const v = vis.get(a.data.id); if (v) return v; } return root; };
    const anchorOld = d => { for (let a = d.parent; a; a = a.parent) { const p = prev.get(a.data.id); if (p) return p; } return { x: root.x, y: root.y }; };
    const point = (x, y) => `M${y},${x} C${y},${x} ${y},${x} ${y},${x}`;
    // Без анимации всё ставится сразу, а не кадром позже.
    const tr = sel => dur ? sel.transition().duration(dur).ease(ease) : sel;

    gLinks.selectAll('path').data(links, l => l.target.data.id).join(
      enter => enter.append('path').attr('class', 'link-l').attr('d', l => { const o = prev.get(l.source.data.id) ?? l.source; return point(o.x, o.y); }),
      update => update,
      exit => dur ? exit.transition().duration(dur).ease(ease).attr('d', l => { const a = anchorNew(l.target); return point(a.x, a.y); }).remove() : exit.remove(),
    ).call(sel => tr(sel).attr('d', l => {
        const p = l.source, c = l.target;
        const sx = p.y + labelWidth(p) + 6;
        const ex = colX[p.depth] + (wmax[p.depth] || 0) + 12;
        const tx = c.y - 9, mx = ex + (tx - ex) * 0.5;
        return `M${sx},${p.x} C${mx},${p.x} ${mx},${c.x} ${tx},${c.x}`;
      }));

    const q = norm(opts.query.trim());
    const nd = gNodes.selectAll('g.node').data(nodes, d => d.data.id);
    if (dur) nd.exit().transition().duration(dur).ease(ease)
      .attr('transform', d => { const a = anchorNew(d); return `translate(${a.y},${a.x})`; }).style('opacity', 0).remove();
    else nd.exit().remove();
    const ne = nd.enter().append('g').attr('tabindex', 0).attr('role', 'treeitem')
      .attr('transform', d => { const o = prev.get(d.data.id) ?? anchorOld(d); return `translate(${o.y},${o.x})`; })
      .style('opacity', dur ? 0 : 1)
      .on('click', (e, d) => { e.stopPropagation(); select(d); })
      .on('keydown', (e, d) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(d); }
        else if (e.key === 'ArrowRight' && d._kids && !d.children) { e.preventDefault(); toggle(d); }
        else if (e.key === 'ArrowLeft' && d.children) { e.preventDefault(); toggle(d); }
      });
    ne.append('rect').attr('class', 'hit');
    ne.append('circle').attr('class', 'dot').attr('r', 7).on('click', (e, d) => { e.stopPropagation(); toggle(d); });
    ne.append('text').attr('class', 'nm').attr('x', 13).attr('dy', '0.34em');

    const all = ne.merge(nd);
    tr(all).attr('transform', d => `translate(${d.y},${d.x})`).style('opacity', 1);
    all
      .attr('class', d => 'node' + (!d._kids ? ' leaf' : d.children ? '' : ' closed') + (d.depth < TOP_DEPTH ? ' top' : '')
        + (q && norm(d.data.name).includes(q) ? ' hl' : '') + (d.data.id === opts.selectedId ? ' sel' : '')
        + (d.data.draft ? ' draft' : ''))
      .attr('aria-expanded', d => d._kids ? String(!!d.children) : null)
      .attr('aria-level', d => d.depth + 1)
      .attr('aria-label', d => d.data.name + (d.data.spouse ? ', ' + d.data.spouse : '') + (d._kids ? `, детей: ${d._kids.length}` : ''))
      .each(function (d) {
        const t = d3.select(this).select('text.nm');
        t.selectAll('*').remove();
        t.text(d.data.name);
        const sps = spousesOf(d.data.id);
        if (d.data.spouse && !sps.length) t.append('tspan').attr('class', 'sp').text('  ' + clip(d.data.spouse, 22)).append('title').text(d.data.spouse);
        if (d._kids && !d.children) t.append('tspan').attr('class', 'cnt').text('  +' + countDesc(d));
        sps.forEach(id => {
          const s = byId(id);
          if (s) t.append('tspan').attr('class', 'mar').text('  ⚭ ' + s.data.name);
        });
        const bb = t.node().getBBox(), h = ROW() - 4;
        d3.select(this).select('rect.hit').attr('x', -16).attr('y', -h / 2).attr('width', bb.width + 32).attr('height', h);
      });

    const pairs = opts.marriages.filter(m => vis.has(m.a_id) && vis.has(m.b_id)).map(m => [vis.get(m.a_id), vis.get(m.b_id)]);
    gMar.selectAll('path').data(pairs).join('path').attr('class', 'marlink').attr('d', ([a, b]) => {
      const bend = 50 + Math.min(240, Math.abs(a.x - b.x) * 0.15), xl = Math.min(a.y, b.y) - bend;
      return `M${a.y},${a.x} C${xl},${a.x} ${xl},${b.x} ${b.y},${b.x}`;
    });
    // Связи браков появляются, когда узлы уже на местах.
    if (dur) gMar.interrupt().style('opacity', 0).transition().delay(dur).duration(150).style('opacity', 1);
    prev = new Map(nodes.map(d => [d.data.id, { x: d.x, y: d.y }]));
    extent = { x0: d3.min(nodes, d => d.x), x1: d3.max(nodes, d => d.x), y1: d3.max(nodes, d => d.y + labelWidth(d)) };
  }
  let extent = { x0: 0, x1: 0, y1: 0 };

  function toggle(d) {
    if (!d._kids) return;
    if (open.has(d.data.id)) open.delete(d.data.id); else open.add(d.data.id);
    d.children = open.has(d.data.id) ? d._kids : null;
    draw();
  }
  function select(d) {
    if (d._kids && !d.children) toggle(d);
    onSelect(d.data.id);
  }
  function moveTo(x, y, k, dur = 350) {
    svg.transition().duration(reduce() ? 0 : dur).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
  }

  return {
    render(rootNode, o) {
      const first = !root;
      // Выбранный человек остаётся на том же месте экрана, даже если древо перестроилось.
      const anchorId = o.selectedId ?? opts.selectedId;
      const before = !first && anchorId ? byId(anchorId) : null;
      const was = before && before.x !== undefined ? { x: before.x, y: before.y } : null;
      data = rootNode;
      opts = { ...opts, ...o };
      hierarchy();
      draw();
      if (first) { this.home(0); return; }
      const after = was && byId(anchorId);
      if (after && after.x !== undefined && (after.x !== was.x || after.y !== was.y)) {
        const t = d3.zoomTransform(svg.node());
        svg.call(zoom.transform, t.translate(was.y - after.y, was.x - after.x));
      }
    },
    home(dur = 350) {
      const k = narrow() ? 0.85 : 1;
      moveTo(24 - root.y * k, stage.clientHeight * 0.45 - root.x * k, k, dur);
    },
    // Оставляет родоначальника и его детей, остальные ветки сворачивает.
    collapseAll() {
      all().forEach(d => {
        if (d.depth === 0) { open.add(d.data.id); d.children = d._kids; }
        else { open.delete(d.data.id); d.children = null; }
      });
      draw();
      this.home();
    },
    expandAll() {
      all().forEach(d => { if (d._kids) { open.add(d.data.id); d.children = d._kids; } });
      draw();
      // Всё древо на экран.
      // Размер берём из раскладки, а не из DOM: узлы ещё едут к своим местам.
      const b = { x: -16, y: extent.x0 - 20, width: extent.y1 + 32, height: extent.x1 - extent.x0 + 40 };
      const W = stage.clientWidth, H = stage.clientHeight;
      const k = Math.min(1, Math.max(0.2, Math.min(W / (b.width + 40), H / (b.height + 40))));
      moveTo(20 - b.x * k, Math.max(10, (H - b.height * k) / 2) - b.y * k, k);
    },
    focus(id) {
      const d = byId(id);
      if (!d) return;
      for (let p = d.parent; p; p = p.parent) { open.add(p.data.id); p.children = p._kids; }
      draw();
      const k = narrow() ? 0.85 : 1, W = stage.clientWidth;
      const H = Math.max(80, stage.clientHeight - coveredBottom());   // видимая часть над панелью
      moveTo(W * (narrow() ? 0.12 : 0.3) - d.y * k, H * 0.45 - d.x * k, k);
    },
  };
}
