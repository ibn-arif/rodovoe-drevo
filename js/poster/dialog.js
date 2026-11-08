// Окно «Плакат PDF»: выбор дизайна и размера, превью, скачивание.
import { renderPoster, DESIGNS, PAPER } from './layouts.js';
import { posterPdf, posterFileName, download } from './pdf.js';
import { buildTree } from '../model.js';

// getSnapshot(): снимок с наложенным черновиком — плакат совпадает с тем, что на экране.
export function initPoster(getSnapshot, getTitle) {
  const dlg = document.querySelector('#poster');
  const preview = dlg.querySelector('#poster-preview');
  const status = dlg.querySelector('#poster-status');
  const go = dlg.querySelector('#poster-download');

  const chosen = () => ({
    design: dlg.querySelector('input[name=design]:checked').value,
    paper: dlg.querySelector('input[name=paper]:checked').value,
    palette: dlg.querySelector('input[name=palette]:checked').value,
    tiles: dlg.querySelector('input[name=tiles]:checked').value || null,
  });
  function svgFor() {
    const { design, paper, palette } = chosen();
    const root = buildTree(getSnapshot());
    const count = getSnapshot().people.length;
    return renderPoster(root, { design, paper, palette, title: getTitle(), subtitle: `${count} чел. · ${new Date().toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })}` });
  }
  function update() {
    dlg.querySelector('#palette-box').hidden = chosen().design !== 'fan';
    // Лента — только для «Сверху вниз»; если выбрали другой дизайн, возвращаемся к A0.
    const roll = dlg.querySelector('#roll-option');
    roll.hidden = chosen().design !== 'topdown';
    if (roll.hidden && chosen().paper === 'ROLL') dlg.querySelector('input[name=paper][value=A0]').checked = true;
    const svg = svgFor();
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    preview.replaceChildren(svg);
    status.textContent = svg.dataset.tiny
      ? `На ${chosen().paper} имена будут очень мелкими — выберите размер больше.`
      : '';
  }

  dlg.addEventListener('change', update);
  go.addEventListener('click', async () => {
    const { design, paper } = chosen();
    go.disabled = true;
    const before = status.textContent;
    status.textContent = 'Готовлю плакат…';
    try {
      const { tiles } = chosen();
      const blob = await posterPdf(svgFor(), paper, tiles);
      download(blob, posterFileName(getTitle(), design, paper, tiles));
      status.textContent = before;
    } catch {
      status.textContent = 'Не удалось собрать PDF. Проверьте интернет и попробуйте ещё раз.';
    } finally {
      go.disabled = false;
    }
  });

  return {
    async open() {
      dlg.showModal();
      try { await document.fonts.load('16px "PT Serif"'); await document.fonts.load('700 16px "PT Serif"'); } catch { /* шрифт подставится */ }
      update();
    },
  };
}

export const POSTER_OPTIONS = { DESIGNS, PAPERS: Object.keys(PAPER) };
