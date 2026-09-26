// Chat's one input: ordinary messages, /ai, module commands, and paste import.
// Chat never names a module; commands and Keep actions come from the space APIs.

const OBJECT_MIME = 'application/x-host-object';
const KIND_PLURAL = {
  flight: 'flights', train: 'trains', bus: 'buses', ferry: 'ferries', car: 'cars',
  hotel: 'hotels', restaurant: 'restaurants', cafe: 'cafes', bar: 'bars',
  sight: 'sights', museum: 'museums', tour: 'tours', show: 'shows', note: 'notes',
};

function oneLine(s, n) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function keptText(summary, { question, sourceNames } = {}) {
  const imported = summary && summary.basis === 'imported';
  const extras = [];
  if (!imported) {
    const q = String(question || '').trim();
    const names = (sourceNames || []).filter(Boolean);
    if (q) extras.push(`Asked: ${q}`);
    if (names.length) extras.push(`From: ${names.join(', ')}`);
  }
  const links = (summary && summary.links) || [];
  if (links.length) {
    extras.push('Links:');
    for (const l of links) extras.push(`- ${l.title}: ${l.url}`);
  }
  if (imported) extras.push('External source');
  const suffix = extras.length ? `\n\n${extras.join('\n')}` : '';
  let content = String((summary && summary.content) || '').trim();
  if (content.length + suffix.length > 8000) content = content.slice(0, Math.max(0, 8000 - suffix.length - 1)) + '…';
  return content + suffix;
}

function keepInput(summary, question) {
  return {
    title: oneLine((summary && summary.title) || '', 120) || 'Untitled',
    body: keptText(summary, { question }),
    tags: ((summary && summary.tags) || []).join(', '),
  };
}

function suggestionInput(summary) {
  return {
    title: oneLine((summary && summary.title) || '', 120) || 'Untitled',
    kind: (summary && summary.kind) || '',
    content: keptText(summary, {}),
    place: (summary && summary.place && summary.place.name) || '',
    date: (summary && summary.date) || '',
  };
}

function findKeepers(actions) {
  const note = actions.find((a) => a.name === 'saveNote' && a.input && a.input.title && a.input.body);
  const suggestion = actions.find((a) => a.name === 'acceptSuggestion' && a.input && a.input.title && a.input.kind);
  return { note, suggestion };
}

// An AI answer as the pieces to draw, in order: { text } and { summary: index }.
// Same split the Assistant uses, so a {{summary:N}} marker becomes a preview.
function answerParts(text, summaryCount) {
  const parts = [];
  const drawn = new Set();
  let last = 0;
  const re = /\{\{summary:(\d+)\}\}/g;
  let m;
  const push = (s) => { const t = s.trim(); if (t) parts.push({ text: t }); };
  const src = String(text || '');
  while ((m = re.exec(src))) {
    const n = Number(m[1]);
    if (!(n < summaryCount) || drawn.has(n)) continue;
    push(src.slice(last, m.index));
    parts.push({ summary: n });
    drawn.add(n);
    last = m.index + m[0].length;
  }
  push(src.slice(last));
  for (let i = 0; i < summaryCount; i += 1) if (!drawn.has(i)) parts.push({ summary: i });
  return parts;
}

export function attachChatInput({ $, api, word, getSpace, getMe, canvas, canDo, sendChat, resizeChatInput, setStatus, renderMarkup, openTools, closeTools }) {
  const input = () => $('chat-input');
  const note = () => $('chat-note');
  const importBtn = () => $('chat-import');
  let pendingImport = null;
  let aiContext = [];
  let lastActions = [];

  function spaceId() {
    const s = getSpace();
    return s && !s.isAside ? s.id : null;
  }

  function setNote(text) {
    const el = note();
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function commandList() {
    const list = [];
    list.push({ name: 'ai', label: 'Ask the AI', module: null, moduleName: '', hint: 'a question for the AI', action: null });
    for (const m of canvas.list()) {
      for (const c of m.commands || []) {
        list.push({
          name: c.name,
          label: c.label,
          module: m.id,
          moduleName: m.displayName || m.name,
          hint: c.hint || '',
          action: c.action,
        });
      }
    }
    return list;
  }

  function parseCommand(raw) {
    const text = String(raw || '');
    const m = /^\/([a-z0-9]{1,12})(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!m) return null;
    return { name: m[1], rest: (m[2] || '').trim(), raw: text };
  }

  function matchesFor(name) {
    return commandList().filter((c) => c.name === name);
  }

  function hidePicker() {
    $('chat-command-wrap')?.querySelector('#chat-command-menu')?.remove();
  }

  function showPicker() {
    openTools?.();
    const items = commandList();
    const byName = new Map();
    for (const c of items) {
      const key = c.name;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(c);
    }
    const menu = document.createElement('div');
    menu.className = 'chat-command-menu';
    menu.id = 'chat-command-menu';
    for (const [name, group] of byName) {
      for (const c of group) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chat-command-item';
        const label = group.length > 1 && c.moduleName ? `/${name} (${c.moduleName})` : `/${name}`;
        b.textContent = `${label} — ${c.label}`;
        b.addEventListener('click', () => {
          input().value = `/${name} `;
          input().focus();
          if (c.hint) input().placeholder = c.hint;
          hidePicker();
          resizeChatInput();
        });
        menu.appendChild(b);
      }
    }
    hidePicker();
    $('chat-command-wrap').appendChild(menu);
    const close = (ev) => {
      if (ev.target.closest('#chat-command-wrap')) return;
      hidePicker();
      document.removeEventListener('pointerdown', close, true);
    };
    document.addEventListener('pointerdown', close, true);
  }

  async function loadThread() {
    const id = spaceId();
    if (!id || !getMe()) return;
    try {
      const { entries } = await api('GET', `/api/spaces/${encodeURIComponent(id)}/ai/thread`);
      for (const e of entries || []) {
        if (e.role === 'user') addAiTurn('you', e.text);
        else addAiTurn('ai', e.text, e.summaries || [], e.text);
      }
    } catch {
      // no thread, or not allowed
    }
    await refreshImport();
  }

  function objectPreview(summary, question, onKept) {
    const el = document.createElement('article');
    el.className = 'chat-object';
    if (summary.kind) el.dataset.kind = summary.kind;
    const title = document.createElement('h3');
    title.textContent = oneLine(summary.title, 120) || 'Untitled';
    el.appendChild(title);
    const content = String((summary && summary.content) || '').trim();
    if (content) {
      const body = document.createElement('div');
      body.className = 'chat-object-body';
      body.innerHTML = renderMarkup(content);
      el.appendChild(body);
    }
    const meta = [];
    const place = summary.place && (summary.place.name || summary.place);
    if (place) meta.push(String(place));
    if (summary.date) meta.push(String(summary.date));
    if (summary.kind) meta.push(String(summary.kind));
    if (meta.length) {
      const line = document.createElement('p');
      line.className = 'chat-object-meta';
      line.textContent = meta.join(' · ');
      el.appendChild(line);
    }
    const links = (summary && summary.links) || [];
    if (links.length) {
      const list = document.createElement('p');
      list.className = 'chat-object-meta';
      list.textContent = links.map((l) => l.title || l.url).filter(Boolean).join(' · ');
      el.appendChild(list);
    }
    if (summary && summary.basis === 'imported') {
      const basis = document.createElement('p');
      basis.className = 'chat-object-meta';
      basis.textContent = 'From another AI: check it before you rely on it';
      el.appendChild(basis);
    }
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'msg-btn chat-object-keep';
    keep.textContent = 'Keep';
    keep.addEventListener('click', async () => {
      await keepOne(summary, question, keep);
      if (onKept) onKept(keep);
    });
    el.appendChild(keep);
    return el;
  }

  function addAiTurn(kind, text, summaries, question) {
    const el = document.createElement('div');
    el.className = `message private-ai ${kind === 'you' ? 'own' : 'msg-ai'}`;
    const who = document.createElement('span');
    who.className = 'who';
    const name = document.createElement('span');
    name.textContent = kind === 'you' ? 'You' : 'AI';
    const badge = document.createElement('span');
    badge.className = 'msg-badge msg-badge-private';
    badge.textContent = 'private';
    who.append(name);
    const body = document.createElement('div');
    body.className = 'text';
    const cards = summaries || [];
    if (kind === 'ai' && cards.length) {
      for (const p of answerParts(text, cards.length)) {
        if (p.summary !== undefined) body.appendChild(objectPreview(cards[p.summary], question));
        else {
          const t = document.createElement('div');
          t.innerHTML = renderMarkup(p.text);
          body.appendChild(t);
        }
      }
    } else {
      body.innerHTML = renderMarkup(String(text || ''));
    }
    el.append(who, body);
    if (kind === 'ai') {
      const actions = document.createElement('span');
      actions.className = 'actions';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'msg-btn';
      copy.title = 'Copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => navigator.clipboard.writeText(text || '').catch(() => {}));
      const share = document.createElement('button');
      share.type = 'button';
      share.className = 'msg-btn';
      share.title = `Share to the ${word('space')}`;
      share.textContent = `Share to the ${word('space')}`;
      share.addEventListener('click', () => {
        const me = getMe();
        const label = `AI answer shared by ${me?.displayName || 'someone'}`;
        sendChat(`${label}\n\n${text || ''}`);
      });
      actions.append(copy, share);
      who.append(actions, badge);
    } else {
      who.appendChild(badge);
    }
    $('messages').appendChild(el);
    $('messages').scrollTop = $('messages').scrollHeight;
  }

  async function refreshActions() {
    const id = spaceId();
    if (!id) { lastActions = []; return; }
    try {
      lastActions = (await api('GET', `/api/spaces/${encodeURIComponent(id)}/actions`)).actions || [];
    } catch {
      lastActions = [];
    }
  }

  async function keepOne(summary, question, btn) {
    await refreshActions();
    const { note, suggestion } = findKeepers(lastActions);
    const placer = (summary.kind && suggestion) ? suggestion : note;
    if (!placer) { setNote('Nothing here can keep that yet.'); return; }
    const input = placer.name === 'acceptSuggestion' ? suggestionInput(summary) : keepInput(summary, question);
    try {
      const out = await api('POST', `/api/spaces/${encodeURIComponent(spaceId())}/action`, { action: placer.action, input });
      if (btn) {
        btn.classList.add(out.status === 'queued' ? 'queued' : 'kept');
        if (out.status === 'queued') btn.title = `Waiting: it is kept when that ${word('module')} is next open`;
      }
    } catch (err) {
      setNote(err.message || 'Could not keep that.');
    }
  }

  async function askAbout({ question, refs } = {}) {
    const q = String(question || '').trim();
    if (!q) { setNote('Type a question after /ai.'); return { ok: false }; }
    const prev = aiContext;
    aiContext = (refs || []).filter((r) => r && r.module && r.id).map((ref) => ({ ref }));
    try {
      input().focus();
      const ok = await runAi(q);
      return { ok };
    } finally {
      aiContext = prev;
    }
  }

  async function runAi(question) {
    const id = spaceId();
    if (!id) { setNote(`AI is only in ${word('space', { a: true })}.`); return false; }
    addAiTurn('you', question);
    try {
      const reply = await api('POST', `/api/spaces/${encodeURIComponent(id)}/ai`, {
        question,
        refs: aiContext.map((c) => c.ref).filter(Boolean),
      });
      addAiTurn('ai', reply.text, reply.summaries || [], question);
      return true;
    } catch (err) {
      setNote(err.message || 'The AI could not answer.');
      return false;
    }
  }

  async function runCommand(parsed) {
    const hits = matchesFor(parsed.name);
    if (!hits.length) {
      setNote(`No command /${parsed.name}`);
      return false;
    }
    const openHits = hits.filter((h) => !h.module || canvas.isOpen(h.module));
    if (hits[0].name === 'ai') {
      if (!parsed.rest) { setNote('Type a question after /ai.'); return false; }
      const ok = await runAi(parsed.rest);
      return ok;
    }
    if (hits.length > 1 && openHits.length !== 1) {
      const names = hits.map((h) => h.moduleName).join(' or ');
      setNote(`Which one: ${names}? Use the picker.`);
      return false;
    }
    const chosen = openHits[0] || hits[0];
    if (chosen.module && !canvas.isOpen(chosen.module)) {
      setNote(`${chosen.moduleName} isn't open`);
      return false;
    }
    try {
      await api('POST', `/api/spaces/${encodeURIComponent(spaceId())}/command`, {
        name: parsed.name,
        text: parsed.rest,
        module: chosen.module,
      });
      return true;
    } catch (err) {
      setNote(err.message || `${chosen.moduleName} isn't open`);
      return false;
    }
  }

  function droppedLine(dropped, over) {
    const parts = [];
    const list = Array.isArray(dropped) ? dropped : [];
    if (list.length) {
      const counts = new Map();
      for (const d of list) counts.set(d.why, (counts.get(d.why) || 0) + 1);
      const phrase = (why, n) => {
        if (why === 'it has no title') return n === 1 ? '1 had no title' : `${n} had no title`;
        if (why === 'it has no content') return n === 1 ? '1 had no content' : `${n} had no content`;
        if (why === 'not valid JSON') return n === 1 ? '1 was not valid JSON' : `${n} were not valid JSON`;
        if (why === `not ${word('object', { a: true })}`) return n === 1 ? `1 was not ${word('object', { a: true })}` : `${n} were not ${word('object', { many: true })}`;
        return `${n} ${why}`;
      };
      parts.push(`${list.length} could not be read: ${[...counts].map(([w, n]) => phrase(w, n)).join(', ')}.`);
    }
    if (over) parts.push(`${over} more were left out: at most 50 at a time.`);
    return parts.join(' ');
  }

  function setImportWhy(text) {
    const el = $('chat-import-why');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function setImportOpen(yes) {
    const panel = $('chat-import-panel');
    if (!panel) return;
    panel.hidden = !yes;
    if (yes) {
      hidePicker();
      $('chat-help-popup').hidden = true;
      $('chat-emoji-popup').hidden = true;
      setImportWhy('');
    }
  }

  function isKept(btn) {
    return Boolean(btn && (btn.classList.contains('kept') || btn.classList.contains('queued')));
  }

  function showImport(result) {
    const objects = (result && result.objects) || [];
    const dropped = droppedLine(result && result.dropped, result && result.over);
    if (!objects.length) {
      setImportWhy(dropped || 'Nothing in that could be read.');
      return;
    }
    setImportOpen(false);
    setImportWhy('');
    const wrap = document.createElement('div');
    wrap.className = 'message private-ai msg-ai chat-import-msg';
    const who = document.createElement('span');
    who.className = 'who';
    const name = document.createElement('span');
    name.textContent = 'Brought in';
    who.appendChild(name);
    const body = document.createElement('div');
    body.className = 'text';
    const rows = [];
    for (const obj of objects) {
      const row = document.createElement('label');
      row.className = 'chat-import-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('aria-label', 'Keep this one');
      const preview = objectPreview({ ...obj, basis: 'imported' }, '', (btn) => {
        if (isKept(btn)) box.disabled = true;
        refresh();
      });
      const keepBtn = preview.querySelector('.chat-object-keep');
      row.append(box, preview);
      rows.push({ box, keepBtn, obj });
      body.appendChild(row);
    }
    const foot = document.createElement('div');
    foot.className = 'chat-import-foot';
    const keepTicked = document.createElement('button');
    keepTicked.type = 'button';
    keepTicked.className = 'btn btn-primary btn-small';
    const droppedEl = document.createElement('p');
    droppedEl.className = 'chat-import-dropped';
    droppedEl.textContent = dropped;
    const ticked = () => rows.filter((r) => r.box.checked && !isKept(r.keepBtn));
    const refresh = () => {
      keepTicked.textContent = `Keep ticked (${ticked().length})`;
    };
    refresh();
    wrap.addEventListener('change', refresh);
    keepTicked.addEventListener('click', async () => {
      const left = ticked();
      if (!left.length) return;
      const counts = new Map();
      for (const r of left) {
        const k = r.obj.kind && findKeepers(lastActions).suggestion ? r.obj.kind : 'note';
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const what = [...counts].map(([k, n]) => `${n} ${n === 1 ? k : (KIND_PLURAL[k] || `${k}s`)}`).join(' and ');
      if (!window.confirm(`Keep ${what}?`)) return;
      keepTicked.disabled = true;
      await refreshActions();
      for (const r of left) {
        await keepOne({ ...r.obj, basis: 'imported' }, '', r.keepBtn);
        if (isKept(r.keepBtn)) r.box.disabled = true;
      }
      keepTicked.disabled = false;
      refresh();
    });
    foot.append(keepTicked, droppedEl);
    body.appendChild(foot);
    wrap.append(who, body);
    $('messages').appendChild(wrap);
    $('messages').scrollTop = $('messages').scrollHeight;
  }

  async function postCheck(body, type) {
    const id = spaceId();
    if (!id) throw new Error(`Bring research in from ${word('space', { a: true })}.`);
    const result = await fetch(`/api/spaces/${encodeURIComponent(id)}/objects/check`, {
      method: 'POST',
      headers: { 'content-type': type, accept: 'application/json' },
      body,
    });
    const json = await result.json();
    if (!result.ok) throw new Error(json.error || 'That could not be read.');
    return json;
  }

  async function checkObjects(input) {
    setImportWhy('');
    try {
      const result = typeof input === 'string'
        ? await postCheck(input, 'text/plain')
        : await postCheck(input, 'application/octet-stream');
      pendingImport = null;
      importBtn().hidden = true;
      showImport(result);
    } catch (err) {
      setImportWhy(err.message || 'That could not be read.');
      setImportOpen(true);
    }
  }

  async function refreshImport() {
    await refreshActions();
    const { note, suggestion } = findKeepers(lastActions);
    let ok = false;
    try {
      const id = spaceId();
      if (id && getMe() && (note || suggestion)) {
        const avail = await api('GET', `/api/spaces/${encodeURIComponent(id)}/objects/check`);
        ok = Boolean(avail.available);
      }
    } catch {
      ok = false;
    }
    const btn = $('chat-bring');
    if (btn) btn.hidden = !ok;
    if (!ok) setImportOpen(false);
  }

  async function offerImport(text) {
    const id = spaceId();
    if (!id || !getMe()) return;
    try {
      const avail = await api('GET', `/api/spaces/${encodeURIComponent(id)}/objects/check`);
      if (!avail.available) return;
      const json = await postCheck(text, 'text/plain');
      if (!json.objects || !json.objects.length) return;
      pendingImport = json;
      const btn = importBtn();
      btn.hidden = false;
      btn.textContent = `Bring in ${json.objects.length} ${word('object', { many: json.objects.length !== 1 })}`;
      const panelText = $('chat-import-text');
      if (panelText && !panelText.value.trim()) panelText.value = text;
    } catch {
      // not an import
    }
  }

  $('chat-command').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $('chat-help-popup').hidden = true;
    $('chat-emoji-popup').hidden = true;
    if ($('chat-command-menu')) hidePicker();
    else showPicker();
  });
  $('chat-bring')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const panel = $('chat-import-panel');
    const opening = panel.hidden;
    setImportOpen(opening);
    if (opening) closeTools?.();
  });
  $('chat-import-close')?.addEventListener('click', (e) => {
    e.preventDefault();
    setImportOpen(false);
  });
  $('chat-import-copy')?.addEventListener('click', async (e) => {
    e.preventDefault();
    setImportWhy('');
    const show = $('chat-import-show');
    if (show) show.hidden = true;
    try {
      const fmt = await api('GET', '/api/objects/format');
      const text = (fmt && fmt.instructions) || '';
      try {
        await navigator.clipboard.writeText(text);
        setNote('Copied. Paste it into the other AI first.');
      } catch {
        if (show) {
          show.value = text;
          show.hidden = false;
          show.focus();
          show.select();
        }
        setNote('Select all and copy it.');
      }
    } catch (err) {
      setImportWhy(err.message || 'The instructions could not be copied.');
    }
  });
  $('chat-import-check')?.addEventListener('click', (e) => {
    e.preventDefault();
    checkObjects($('chat-import-text').value);
  });
  $('chat-import-choose')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('chat-import-file').click();
  });
  $('chat-import-file')?.addEventListener('change', () => {
    const file = $('chat-import-file').files && $('chat-import-file').files[0];
    if (file) checkObjects(file);
  });
  $('chat-import-panel')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setImportOpen(false);
      input().focus();
    }
  });
  importBtn().addEventListener('click', (e) => {
    e.preventDefault();
    if (pendingImport) showImport(pendingImport);
    pendingImport = null;
    importBtn().hidden = true;
  });
  input().addEventListener('input', () => {
    const parsed = parseCommand(input().value);
    if (input().value.trim() === '/') showPicker();
    if (!parsed) input().placeholder = 'Say something...';
    else if (parsed.name === 'ai') input().placeholder = 'a question for the AI';
    if (!input().value.trim()) { pendingImport = null; importBtn().hidden = true; setNote(''); }
  });
  input().addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (text.length > 40) offerImport(text);
  });

  $('chat').addEventListener('drop', (event) => {
    const raw = event.dataTransfer?.getData(OBJECT_MIME);
    if (!raw || parseCommand(input().value || '')?.name !== 'ai') return;
    try {
      const ref = JSON.parse(raw);
      if (ref && ref.module && ref.id) {
        aiContext.push({ ref });
        setNote(`Asking with ${aiContext.length} ${word('object', { many: aiContext.length !== 1 })}`);
      }
    } catch {
      // not an object
    }
  });

  return {
    async handleSubmit(text) {
      setNote('');
      const parsed = parseCommand(text);
      if (!parsed) return false;
      const sent = await runCommand(parsed);
      return sent;
    },
    loadThread,
    refreshActions,
    hidePicker,
    hideImport: () => setImportOpen(false),
    askAbout,
  };
}
