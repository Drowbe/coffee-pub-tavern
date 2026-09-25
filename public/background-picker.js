// The picker for a pre-made background: a dialog with the library's images, filtered by theme and style. Used beside an image slot
// (the sign-in background on Manage, a person's own background on their profile) as an alternative to uploading one.
//   pickBackground({ title }) resolves to a File made from the chosen image, or null when it is dismissed. The caller saves it the
//   way it saves an upload, so serving, removal and per-space use all behave as they do for a file the person chose.
import { api, escapeHtml } from '/brand.js';

let open = null;

export function pickBackground({ title = 'Choose a background' } = {}) {
  if (open) return open;
  open = new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'bgpick';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', title);
    root.innerHTML = `
      <div class="bgpick-card">
        <header class="bgpick-head"><h2>${escapeHtml(title)}</h2><button class="bgpick-close" type="button" data-close aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header>
        <div class="bgpick-filters" hidden>
          <div class="bgpick-chips" data-group="theme" role="group" aria-label="Theme"></div>
          <div class="bgpick-chips" data-group="style" role="group" aria-label="Style"></div>
        </div>
        <div class="bgpick-body"><p class="hint bgpick-msg">Loading...</p></div>
        <footer class="bgpick-foot"><span class="bgpick-picked hint">Pick one to preview it.</span><span class="grow"></span><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" data-use disabled>Use this background</button></footer>
      </div>`;
    document.body.appendChild(root);
    const body = root.querySelector('.bgpick-body');
    const useBtn = root.querySelector('[data-use]');
    const picked = root.querySelector('.bgpick-picked');
    let list = [];
    const filter = { theme: '', style: '' };
    let chosen = null;

    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      root.remove();
      open = null;
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    root.addEventListener('click', async (e) => {
      if (e.target === root || e.target.closest('[data-close]')) return finish(null);
      const chip = e.target.closest('[data-chip]');
      if (chip) {
        const group = chip.closest('[data-group]').dataset.group;
        filter[group] = chip.dataset.chip;
        draw();
        return;
      }
      const tile = e.target.closest('[data-file]');
      if (tile) {
        chosen = list.find((b) => b.file === tile.dataset.file) || null;
        for (const t of body.querySelectorAll('[data-file]')) t.setAttribute('aria-pressed', String(t === tile));
        useBtn.disabled = !chosen;
        picked.textContent = chosen ? chosen.label : 'Pick one to preview it.';
        return;
      }
      if (e.target.closest('[data-use]') && chosen) {
        useBtn.disabled = true;
        useBtn.textContent = 'Applying...';
        try {
          const res = await fetch(chosen.url);
          if (!res.ok) throw new Error('that image could not be loaded');
          const blob = await res.blob();
          finish(new File([blob], chosen.file, { type: blob.type || 'image/webp' }));
        } catch (err) {
          useBtn.disabled = false;
          useBtn.textContent = 'Use this background';
          picked.textContent = err.message;
        }
      }
    });

    const chips = (group, values) => `<button class="bgpick-chip${filter[group] === '' ? ' on' : ''}" type="button" data-chip="">All ${group}s</button>` + values.map((v) => `<button class="bgpick-chip${filter[group] === v ? ' on' : ''}" type="button" data-chip="${escapeHtml(v)}">${escapeHtml(v.charAt(0).toUpperCase() + v.slice(1))}</button>`).join('');
    function draw() {
      const themes = [...new Set(list.map((b) => b.theme))];
      const styles = [...new Set(list.filter((b) => !filter.theme || b.theme === filter.theme).map((b) => b.style))];
      root.querySelector('[data-group="theme"]').innerHTML = chips('theme', themes);
      root.querySelector('[data-group="style"]').innerHTML = chips('style', styles);
      root.querySelector('[data-group="theme"]').hidden = themes.length < 2;
      root.querySelector('[data-group="style"]').hidden = styles.length < 2;
      root.querySelector('.bgpick-filters').hidden = themes.length < 2 && styles.length < 2;
      const shown = list.filter((b) => (!filter.theme || b.theme === filter.theme) && (!filter.style || b.style === filter.style));
      body.innerHTML = shown.length
        ? `<div class="bgpick-grid">${shown.map((b) => `<button class="bgpick-tile" type="button" data-file="${escapeHtml(b.file)}" aria-pressed="${chosen && chosen.file === b.file}" title="${escapeHtml(b.label)}"><img src="${escapeHtml(b.url)}" alt="" loading="lazy" decoding="async"><span>${escapeHtml(b.label)}</span></button>`).join('')}</div>`
        : '<p class="hint bgpick-msg">Nothing matches.</p>';
    }
    api('GET', '/api/backgrounds').then((d) => {
      list = d.backgrounds || [];
      if (!list.length) body.innerHTML = '<p class="hint bgpick-msg">No pre-made backgrounds are installed yet. You can still upload your own.</p>';
      else draw();
    }).catch(() => { body.innerHTML = '<p class="hint bgpick-msg error">The library could not be loaded.</p>'; });
    root.querySelector('[data-use]').focus?.();
  });
  return open;
}
