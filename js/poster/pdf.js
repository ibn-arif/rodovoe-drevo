// SVG плаката → PDF в браузере: jsPDF + svg2pdf.js, шрифт PT Serif встраивается в файл (нужен для буквы Ӏ).
/* global jspdf */
import { PAPER } from './layouts.js';

const FONTS = [['PTSerif-Regular.ttf', 'normal', 'normal'], ['PTSerif-Bold.ttf', 'normal', 'bold'], ['PTSerif-Italic.ttf', 'italic', 'normal']];
const base = new URL('../../vendor/', import.meta.url);
let fontData;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('network'));
    document.head.append(s);
  });
}

async function ready() {
  if (!globalThis.jspdf) await loadScript(new URL('jspdf.umd.min.js', base).href);
  if (!globalThis.jspdf.jsPDF.API.svg) await loadScript(new URL('svg2pdf.umd.min.js', base).href);
  fontData ??= Promise.all(FONTS.map(async ([file]) => {
    const buf = new Uint8Array(await (await fetch(new URL('fonts/' + file, base))).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }));
  return fontData;
}

export async function posterPdf(svg, paper) {
  const fonts = await ready();
  // Размер берём из самого плаката: «Сверху вниз» может быть альбомным.
  const [, , W, H] = svg.getAttribute('viewBox').split(' ').map(Number);
  const doc = new jspdf.jsPDF({ unit: 'mm', format: [W, H], orientation: W > H ? 'landscape' : 'portrait', compress: true });
  FONTS.forEach(([file, style, weight], i) => {
    doc.addFileToVFS(file, fonts[i]);
    doc.addFont(file, 'PTSerif', style, weight);
  });
  doc.setFont('PTSerif', 'normal');
  // Имя шрифта в PDF не может содержать пробел: «PT Serif» → «PTSerif».
  svg.querySelectorAll('[font-family]').forEach(n => n.setAttribute('font-family', 'PTSerif'));
  // svg2pdf читает геометрию из DOM, поэтому SVG временно кладётся в документ.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden';
  holder.append(svg);
  document.body.append(holder);
  try {
    await doc.svg(svg, { x: 0, y: 0, width: W, height: H });
  } finally {
    holder.remove();
  }
  return doc.output('blob');
}

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ӏ: 'i' };

export function posterFileName(title, design, paper) {
  const t = String(title).toLowerCase().replace(/^род\s+/, '').split('').map(c => TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'drevo';
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return `Rod_${cap}_${design}_${paper}.pdf`;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}
