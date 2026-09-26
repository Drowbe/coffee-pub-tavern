// Chat's one input: ordinary messages, /ai, module commands, and paste import.
// Chat never names a module; commands and Keep actions come from the space APIs.

const OBJECT_MIME = 'application/x-host-object';

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

export function attachChatInput({ $, api, word, getSpace, getMe, canvas, canDo, sendChat, resizeChatInput, setStatus, renderMarkup }) {
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

  function showPicker() {
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
          menu.remove();
          resizeChatInput();
        });
        menu.appendChild(b);
      }
    }
    $('chat-command-wrap').querySelector('#chat-command-menu')?.remove();
    $('chat-command-wrap').appendChild(menu);
    const close = (ev) => {
      if (ev.target.closest('#chat-command-wrap')) return;
      menu.remove();
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
  }

  function addAiTurn(kind, text, summaries, question) {
    const el = document.createElement('div');
    el.className = `message private-ai ${kind === 'you' ? 'own' : 'msg-ai'}`;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = kind === 'you' ? 'You' : 'AI';
    const mark = document.createElement('span');
    mark.className = 'when';
    mark.textContent = kind === 'ai' ? 'Only you can see this' : '';
    who.appendChild(mark);
    const body = document.createElement('span');
    body.className = 'text';
    body.innerHTML = renderMarkup(String(text || '').replace(/\{\{summary:\d+\}\}/g, ''));
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
      if (summaries && summaries.length) {
        for (const s of summaries) {
          const keep = document.createElement('button');
          keep.type = 'button';
          keep.className = 'msg-btn';
          keep.textContent = 'Keep';
          keep.addEventListener('click', () => keepOne(s, question, keep));
          actions.append(keep);
        }
      }
      el.append(actions);
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

  async function offerImport(text) {
    const id = spaceId();
    if (!id || !getMe()) return;
    try {
      const avail = await api('GET', `/api/spaces/${encodeURIComponent(id)}/objects/check`);
      if (!avail.available) return;
      const result = await fetch(`/api/spaces/${encodeURIComponent(id)}/objects/check`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', accept: 'application/json' },
        body: text,
      });
      const json = await result.json();
      if (!result.ok || !json.objects || !json.objects.length) return;
      pendingImport = json;
      const btn = importBtn();
      btn.hidden = false;
      btn.textContent = `Bring in ${json.objects.length} ${word('object', { many: json.objects.length !== 1 })}`;
    } catch {
      // not an import
    }
  }

  async function keepImport() {
    if (!pendingImport) return;
    await refreshActions();
    for (const obj of pendingImport.objects) {
      await keepOne({ ...obj, basis: 'imported' }, '', null);
    }
    pendingImport = null;
    importBtn().hidden = true;
    input().value = '';
    resizeChatInput();
    setNote('');
  }

  $('chat-command').addEventListener('click', (e) => {
    e.preventDefault();
    showPicker();
  });
  importBtn().addEventListener('click', (e) => {
    e.preventDefault();
    keepImport();
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
  };
}
