// "Add a region": find a place, confirm roughly how big the cut would be (nothing downloads before that), then cut it in
// as a background job followed over server-sent events. Shared by a module's configuration page (a self-hosted install,
// where the module's folder is the admin's own) and the host console (a host with environments, where the folder is the
// host's and only a host admin cuts). Both pages carry the same markup with the same ids (module-config.html's
// #cfg-region block). `base` is the region-cut API root (`.../region-cut`); `onDone(name)` runs once a cut has landed.
import { api } from '/brand.js';

const $ = (id) => document.getElementById(id);

export function wireRegionCut({ base, onDone }) {
  const box = $('cfg-region');
  box.hidden = false;
  const form = $('region-find-form');
  const q = $('region-q');
  const findBtn = $('region-find-btn');
  const findStatus = $('region-find-status');
  const worldBtn = $('region-world-btn');
  const confirmBox = $('region-confirm');
  const confirmName = $('region-confirm-name');
  const minZoomEl = $('region-min-zoom');
  const zoomEl = $('region-zoom');
  const nameEl = $('region-filename');
  const estimateBtn = $('region-estimate-btn');
  const estimateStatus = $('region-estimate-status');
  const cutBtn = $('region-cut-btn');
  const cancelBtn = $('region-cancel-btn');
  const progress = $('region-progress');
  const progressName = $('region-progress-name');
  const progressBar = $('region-progress-bar');
  const progressMessage = $('region-progress-message');

  let found = null; // { name, box }
  let source = null; // the open EventSource, while a cut is running
  // A basic, low-zoom layer for the whole map (within Web Mercator's own latitude limit -- the projection every
  // PMTiles file uses), meant to sit under detailed regional cuts, not replace them.
  const WORLD_BOX = { minLon: -180, minLat: -85, maxLon: 180, maxLat: 85 };
  const WORLD_ZOOM = 5;

  const slug = (text) => (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'region';

  const setEstimateStatus = (text, isError) => {
    estimateStatus.textContent = text;
    estimateStatus.classList.toggle('error', Boolean(isError));
  };

  const reset = () => {
    q.value = '';
    q.disabled = false;
    findBtn.disabled = false;
    findStatus.textContent = '';
    findStatus.classList.remove('error');
    confirmBox.hidden = true;
    progress.hidden = true;
    found = null;
    setEstimateStatus('', false);
    cutBtn.disabled = true;
    estimateBtn.disabled = false; // a finished cut leaves it disabled (see the cut handler below); the next region needs it back
  };

  // What to confirm before anything downloads, shared by a named-place find and the whole-world shortcut.
  const showConfirm = (name, box, defaultZoom) => {
    found = { name, box };
    findStatus.textContent = '';
    confirmName.textContent = name;
    nameEl.value = `${slug(name)}.pmtiles`;
    minZoomEl.value = '0';
    zoomEl.value = String(defaultZoom);
    setEstimateStatus('', false);
    cutBtn.disabled = true;
    confirmBox.hidden = false;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = q.value.trim();
    if (text.length < 2) return;
    q.disabled = true;
    findBtn.disabled = true;
    findStatus.classList.remove('error');
    findStatus.textContent = 'Looking…';
    try {
      const res = await api('GET', `${base}/find?q=${encodeURIComponent(text)}`);
      if (!res.found) findStatus.textContent = `No place called "${text}" was found.`;
      else showConfirm(res.name, res.box, 14);
    } catch (err) {
      findStatus.textContent = err.message;
      findStatus.classList.add('error');
    }
    q.disabled = false;
    findBtn.disabled = false;
  });

  // No search needed: a fixed box for the whole map, defaulting to a low zoom (a country-sized file at street-level
  // zoom would be enormous) -- the admin can still raise it, Check size shows the real cost either way.
  worldBtn.addEventListener('click', () => {
    findStatus.textContent = '';
    findStatus.classList.remove('error');
    showConfirm('the whole world', WORLD_BOX, WORLD_ZOOM);
    nameEl.value = 'world.pmtiles';
  });

  // A changed zoom (min or max), or a fresh find, needs a fresh estimate before Cut and add is trusted again.
  minZoomEl.addEventListener('input', () => { cutBtn.disabled = true; setEstimateStatus('', false); });
  zoomEl.addEventListener('input', () => { cutBtn.disabled = true; setEstimateStatus('', false); });

  // Both fields, clamped and read together: minimum never above maximum.
  function readZoomRange() {
    const maxZoom = Math.max(0, Math.min(15, Math.round(Number(zoomEl.value) || 0)));
    zoomEl.value = String(maxZoom);
    const minZoom = Math.max(0, Math.min(maxZoom, Math.round(Number(minZoomEl.value) || 0)));
    minZoomEl.value = String(minZoom);
    return { minZoom, maxZoom };
  }

  estimateBtn.addEventListener('click', async () => {
    if (!found) return;
    estimateBtn.disabled = true;
    setEstimateStatus('Checking size…', false);
    try {
      const { minZoom, maxZoom } = readZoomRange();
      const est = await api('POST', `${base}/estimate`, { ...found.box, minZoom, maxZoom });
      const size = est.bytes >= 1e9 ? `${(est.bytes / 1e9).toFixed(1)} GB` : est.bytes >= 1e6 ? `${(est.bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(est.bytes / 1e3))} kB`;
      setEstimateStatus(`About ${est.tiles} tile${est.tiles === 1 ? '' : 's'}, ${size}.`, false);
      cutBtn.disabled = false;
    } catch (err) {
      setEstimateStatus(err.message, true);
      cutBtn.disabled = true;
    }
    estimateBtn.disabled = false;
  });

  cancelBtn.addEventListener('click', reset);

  cutBtn.addEventListener('click', async () => {
    if (!found || cutBtn.disabled) return;
    const name = nameEl.value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.pmtiles$/.test(name)) {
      setEstimateStatus('That file name will not do: letters, digits, dot, dash and underscore only, ending in .pmtiles.', true);
      return;
    }
    cutBtn.disabled = true;
    estimateBtn.disabled = true;
    const { minZoom, maxZoom } = readZoomRange();
    try {
      const out = await api('POST', base, { ...found.box, minZoom, maxZoom, name });
      confirmBox.hidden = true;
      progress.hidden = false;
      progressName.textContent = `Cutting ${name}…`;
      progressBar.value = 0;
      progressMessage.textContent = 'Starting…';
      follow(out.id, name);
    } catch (err) {
      setEstimateStatus(err.message, true);
      cutBtn.disabled = false;
      estimateBtn.disabled = false;
    }
  });

  function follow(jobId, name) {
    if (source) source.close();
    source = new EventSource(`${base}/${encodeURIComponent(jobId)}/stream`);
    source.addEventListener('progress', (ev) => {
      let data = {};
      try { data = JSON.parse(ev.data); } catch (err) { /* skip a line we cannot read */ }
      progressBar.value = data.percent || 0;
      progressMessage.textContent = data.message || '';
    });
    source.addEventListener('done', async () => {
      source.close();
      source = null;
      progressBar.value = 100;
      progressMessage.textContent = 'Done.';
      if (onDone) await onDone(name);
      setTimeout(reset, 1500);
    });
    source.addEventListener('error', (ev) => {
      source.close();
      source = null;
      let message = 'the cut failed';
      try { message = JSON.parse(ev.data).error || message; } catch (err) { /* a connection error, not a server one */ }
      progress.hidden = true;
      confirmBox.hidden = false;
      setEstimateStatus(message, true);
      cutBtn.disabled = false;
      estimateBtn.disabled = false;
    });
  }
}
