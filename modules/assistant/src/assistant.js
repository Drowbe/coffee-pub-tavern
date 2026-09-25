// Assistant: a normal bundled module (dock, float, popout), a place to have an open-ended conversation with the AI the admin set
// up. It keeps no data of its own: a person may add context (any object with a summary, from any module this one may consume), and a
// summary the model writes worth keeping is saved by whichever module offers a note-shaped save action, found by name and input
// shape (never by naming a module). The conversation itself is never stored, on the server or here; closing the pane, or New
// conversation, drops it. This page draws into the markup in assistant.html by cloning its templates and filling their [data-slot]
// and [data-icon] hooks, and toggles the state classes and data attributes CONTRACT.md lists. It builds no markup from strings and
// sets no style. Nothing here names another module.
(async () => {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const word = host.util.word; // the environment's word for a level or role (host.locale().words)
  const $ = (id) => root.getElementById(id);

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    $('msg').textContent = 'Assistant could not start: ' + err.message;
    return;
  }
  const geo = host.util.geo;
  /*__LIB__*/

  // --- small helpers (as every module has: never shared beyond the SDK, so each stays simple and easy to read on its own) -----

  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      const empty = value === '' || value == null;
      if (s) { s.textContent = empty ? '' : String(value); s.hidden = empty; }
      const wrap = slot(el, `${name}-wrap`);
      if (wrap) wrap.hidden = empty;
    }
  }
  const iconSvg = new Map();
  const iconWait = new Map();
  function wantIcon(name) {
    if (iconSvg.has(name)) return Promise.resolve(iconSvg.get(name));
    if (!iconWait.has(name)) iconWait.set(name, host.ui.icon(name).then((svg) => { iconSvg.set(name, svg); return svg; }).catch(() => { iconSvg.set(name, ''); return ''; }));
    return iconWait.get(name);
  }
  function hydrate(scope) {
    for (const el of scope.querySelectorAll('[data-icon]')) {
      const name = el.dataset.icon;
      if (!name || el.dataset.shown === name) continue;
      if (iconSvg.has(name)) { el.innerHTML = iconSvg.get(name); el.dataset.shown = name; } else wantIcon(name).then(() => hydrate(scope));
    }
  }
  const setIcon = (node, name) => { if (node) { node.dataset.icon = name || ''; delete node.dataset.shown; node.textContent = ''; } };
  const say = (text, ms) => { const n = $('note'); n.textContent = text || ''; n.hidden = !text; if (text && ms) setTimeout(() => { if (n.textContent === text) say(''); }, ms); };
  const message = (err) => (err && err.message) || String(err);

  const fit = () => {
    const w = host.rootElement.clientWidth;
    if (w) $('app').classList.toggle('narrow', w < 720);
  };
  fit();
  new ResizeObserver(fit).observe(host.rootElement);

  const dayText = (d) => { const t = new Date(`${d}T12:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
  const placeText = (p) => (p ? p.name || geo.coordsText(p.lat, p.lng) : '');
  const objectKey = (r) => `${r.module}:${r.kind}:${r.scope || 'space'}:${r.space || ''}:${r.id}`;

  const state = {
    ai: false,
    aiWhy: '',
    asking: false,
    context: [], // [{ ref, title, icon }]
    saveAction: null, // a note-shaped action (a title, a body of text) to keep an answer's summary with, or null when nothing offers one
    suggestAction: null, // a suggestion-shaped action (a title, a kind) that places a typed summary properly, or null when nothing offers one
  };
  host.util.fillWords($('ask-empty')); // its data-word marks, in this environment's words
  const emptyNode = $('ask-empty'); // the "ask anything" line, moved back into #thread by New conversation

  // --- context: chips, and the picker of anything reachable (this space's objects, and the viewer's own) ----------------------

  const MAX_CONTEXT = 12;
  function drawContext() {
    $('ask-chips').replaceChildren(...state.context.map((it) => {
      const c = clone('tpl-ask-chip');
      c.dataset.key = objectKey(it.ref);
      setIcon(c.querySelector('.ic[data-icon]'), it.icon);
      fill(c, { label: it.title });
      return c;
    }));
    hydrate($('ask-context'));
  }
  function addContext(it) {
    if (state.context.some((x) => objectKey(x.ref) === objectKey(it.ref)) || state.context.length >= MAX_CONTEXT) return;
    state.context.push(it);
    drawContext();
  }
  function removeContext(key) {
    state.context = state.context.filter((x) => objectKey(x.ref) !== key);
    drawContext();
  }
  // Everything this module can offer as context: this space's objects, and the viewer's own (a person's private objects are never
  // linked, but they may still ask about them here). Search rather than a stored list, as any module reaching for another's
  // objects does; no query text, since the picker has no search field of its own.
  async function drawPicker() {
    const list = $('ask-picker-list');
    list.replaceChildren();
    let summaries = [];
    try {
      const [here, mine] = await Promise.all([host.objects.search(''), host.objects.search('', { scope: 'person' }).catch(() => [])]);
      const seen = new Set();
      for (const c of [...here, ...mine]) { const k = objectKey(c.ref); if (!seen.has(k)) { seen.add(k); summaries.push(c); } }
    } catch (err) {
      summaries = [];
    }
    list.replaceChildren(...summaries.map((c) => {
      const r = clone('tpl-pick-row');
      const key = objectKey(c.ref);
      r.dataset.key = key;
      r.dataset.ref = JSON.stringify(c.ref);
      r.dataset.title = c.title || '';
      r.dataset.iconName = (c.module && c.module.icon) || 'note';
      const box = r.querySelector('input');
      box.checked = state.context.some((x) => objectKey(x.ref) === key);
      box.disabled = !box.checked && state.context.length >= MAX_CONTEXT;
      setIcon(r.querySelector('.ic[data-icon]'), r.dataset.iconName);
      fill(r, { title: c.title, kind: c.kindName || c.kind || '' });
      return r;
    }));
    fill($('ask-picker'), { 'picker-count': `${state.context.length} of ${MAX_CONTEXT} chosen` });
    hydrate($('ask-picker'));
  }
  const pickerRows = () => [...$('ask-picker-list').querySelectorAll('.pick-row')];
  $('ask-picker').addEventListener('change', (ev) => {
    const row = ev.target.closest('.pick-row');
    if (!row) return;
    if (ev.target.checked) addContext({ ref: JSON.parse(row.dataset.ref), title: row.dataset.title, icon: row.dataset.iconName });
    else removeContext(row.dataset.key);
    fill($('ask-picker'), { 'picker-count': `${state.context.length} of ${MAX_CONTEXT} chosen` });
    for (const other of pickerRows()) { const box = other.querySelector('input'); if (!box.checked) box.disabled = state.context.length >= MAX_CONTEXT; }
  });

  // --- the conversation -----------------------------------------------------------------------------------------------------

  const thread = () => $('thread');
  const scrollDown = () => { thread().scrollTop = thread().scrollHeight; };
  const BASIS_TEXT = { general: 'From general knowledge: check it before you rely on it', items: 'From your notes', both: 'From your notes and general knowledge' };

  // A source of an answer as a pill: Assistant keeps nothing of its own to look a title up in, so it resolves the pointer live,
  // starting with a plain placeholder and filling it in once the lookup answers; `.gone` when it can no longer be read.
  function sourcePill(ref) {
    const el = clone('tpl-source');
    fill(el, { label: '…' });
    host.objects.resolve(ref).then((summary) => {
      fill(el, { label: summary && !summary.error ? summary.title : `that ${word('object')}` });
      el.classList.toggle('gone', Boolean(summary && summary.error));
    }).catch(() => { fill(el, { label: `that ${word('object')}` }); el.classList.add('gone'); });
    return el;
  }
  const tagNode = (t) => { const el = clone('tpl-tag'); fill(el, { label: t }); return el; };

  function aiCard(c, question) {
    const el = clone('tpl-aicard');
    setIcon(el.querySelector('.badge [data-icon]'), c.icon || 'note');
    fill(el, { title: c.title, place: placeText(c.place), when: c.date ? dayText(c.date) : '', basis: BASIS_TEXT[c.basis] || '' });
    const content = slot(el, 'content');
    content.innerHTML = host.util.markdown(c.content || '');
    content.hidden = !c.content;
    el.dataset.basis = BASIS_TEXT[c.basis] ? c.basis : '';
    el.dataset.kind = c.kind || ''; // an everyday word (flight, hotel, sight...), for the card's colour; see assistant.css
    const tags = slot(el, 'tags');
    tags.replaceChildren(...(c.tags || []).map(tagNode));
    tags.hidden = !(c.tags || []).length;
    const srcs = slot(el, 'sources');
    srcs.replaceChildren(...(c.sources || []).map(sourcePill));
    hide(slot(el, 'sources-wrap'), !(c.sources || []).length);
    const keepBtn = el.querySelector('[data-action="keep-card"]');
    // A card plainly a flight, a hotel, a sight... is placed properly by whichever module recognises its `kind` (a plan, say),
    // found generically; anything else, or nothing recognising it, falls back to an ordinary saved note.
    const placer = c.kind && state.suggestAction ? state.suggestAction : state.saveAction;
    if (!placer) {
      keepBtn.disabled = true;
      keepBtn.title = 'Nothing here can keep an answer yet.';
      el.append(clone('tpl-state-nowhere-to-save'));
    }
    // Keep this one card: used by its own button, and by Send all's per-card loop. Returns true once it is kept (already
    // kept counts too), false when nothing can place it or it failed.
    async function keepOne() {
      if (keepBtn.classList.contains('kept')) return true;
      if (!placer || keepBtn.disabled) return false;
      keepBtn.disabled = true;
      try {
        const out = await host.actions.request(placer.action, await placeInput(placer, c, question), { wait: true });
        if (out.status !== 'done' || !out.result || !out.result.ok) throw new Error((out.result && out.result.error) || 'it could not be saved');
        keepBtn.classList.add('kept');
        return true;
      } catch (err) {
        keepBtn.disabled = false;
        say('It could not be kept: ' + message(err), 4000);
        return false;
      }
    }
    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'copy-card') {
        try { await navigator.clipboard.writeText(`${c.title}\n${c.content}`); say('Copied.', 2000); } catch (err) { say('Select the text and copy it.', 3000); }
      } else if (b.dataset.action === 'keep-card') {
        if (await keepOne()) say('Kept.', 2500);
      }
    });
    el.keepCard = c; // the card this element is for, and how to keep it: read by Send all
    el.keepOne = keepOne;
    return el;
  }
  // What to send a chosen placing action, from a card and the question that produced it: the suggestion shape (kind, place as
  // plain text, no sources: acceptSuggestion-like) or the note shape (keepInput's, with sources named and folded into the body).
  async function placeInput(action, c, question) {
    if (action === state.suggestAction) {
      return { title: c.title, kind: c.kind || '', content: c.content, place: c.place && c.place.name ? c.place.name : '', date: c.date || '' };
    }
    // Name the sources for real (the pills above resolve the same way), so the kept object's own words read as the card does.
    const sources = c.sources || [];
    const named = new Map();
    await Promise.all(sources.map(async (r) => { try { const summary = await host.objects.resolve(r); named.set(r, summary && !summary.error ? summary.title : ''); } catch (err) { named.set(r, ''); } }));
    return keepInput(c, question, (r) => named.get(r) || '');
  }
  // How to call a card's kind in one line, plural or not: "3 hotels", "1 sight", "2 notes" (anything without a kind, or
  // with one nothing here recognises, is a plain note).
  const KIND_PLURAL = { flight: 'flights', train: 'trains', bus: 'buses', ferry: 'ferries', car: 'cars', hotel: 'hotels', restaurant: 'restaurants', cafe: 'cafes', bar: 'bars', sight: 'sights', museum: 'museums', tour: 'tours', show: 'shows', note: 'notes' };
  function showReply(question, reply) {
    const msg = clone('tpl-msg-ai');
    fill(msg, { who: 'AI' });
    const parts = msg.querySelector('.parts');
    const cardEls = [];
    for (const p of answerParts(reply.text, (reply.summaries || []).length)) {
      if (p.summary !== undefined) { const el = aiCard(reply.summaries[p.summary], question); cardEls.push(el); parts.append(el); }
      else { const t = clone('tpl-msg-text'); t.innerHTML = host.util.markdown(p.text); parts.append(t); }
    }
    if (cardEls.length > 1 && (state.saveAction || state.suggestAction)) parts.append(sendAllNode(cardEls));
    return msg;
  }
  // "Send all to plan": once per card, in order, whichever keeping that card's own button would do; skips one already kept.
  // One confirm first, naming what is about to go out.
  function sendAllNode(cardEls) {
    const el = clone('tpl-send-all');
    const btn = el.querySelector('[data-action="send-all"]');
    const notKept = () => cardEls.filter((c) => !c.querySelector('[data-action="keep-card"]').classList.contains('kept'));
    const refresh = () => {
      fill(el, { count: `${cardEls.length} in all` });
      hide(el, !notKept().length);
    };
    refresh();
    btn.addEventListener('click', async () => {
      const left = notKept();
      if (!left.length) return;
      const counts = new Map();
      for (const c of left) { const k = c.keepCard.kind && state.suggestAction ? c.keepCard.kind : 'note'; counts.set(k, (counts.get(k) || 0) + 1); }
      const what = [...counts].map(([k, n]) => `${n} ${n === 1 ? k : KIND_PLURAL[k]}`).join(', ');
      if (!window.confirm(`Send ${what} to your plan?`)) return;
      btn.disabled = true;
      let ok = 0;
      for (const c of left) if (await c.keepOne()) ok += 1;
      btn.disabled = false;
      refresh();
      say(ok === left.length ? `Sent ${ok}.` : `Sent ${ok} of ${left.length}; the rest could not be kept.`, 3000);
    });
    return el;
  }
  async function ask(q) {
    if (q.length < 3 || state.asking || !state.ai) return;
    state.asking = true;
    $('ask-send').disabled = true;
    const you = clone('tpl-msg-you');
    fill(you, { text: q });
    const waiting = document.createElement('div');
    waiting.append(clone('tpl-writing'));
    thread().append(you, waiting);
    hydrate(thread());
    scrollDown();
    try {
      const reply = await host.ai.ask({ task: 'ask', question: q, objects: state.context.map((it) => it.ref) });
      waiting.replaceWith(showReply(q, reply));
    } catch (err) {
      const t = clone('tpl-msg-text');
      fill(t, { text: 'The AI could not answer: ' + message(err) });
      waiting.replaceWith(t);
    } finally {
      state.asking = false;
      $('ask-send').disabled = false;
      hydrate(thread());
      scrollDown();
    }
  }
  $('ask-form').addEventListener('submit', (ev) => { ev.preventDefault(); const q = $('ask-input').value.trim(); $('ask-input').value = ''; ask(q); });
  $('ask-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('ask-form').requestSubmit(); } });
  const newChat = () => thread().replaceChildren(emptyNode);
  $('new-chat').addEventListener('click', newChat);

  // New conversation is a titlebar icon wherever there is a titlebar (a pane, or the module's own window);
  // on the environment page there is none, and the fallback button in .ask-head stays.
  let headerSig = '';
  async function syncHeader() {
    if (!host.header) return;
    const sig = state.ai ? '1' : '0';
    if (sig === headerSig) return;
    headerSig = sig;
    let hosted = false;
    try {
      hosted = await host.header.set(state.ai ? [{ id: 'new-chat', icon: 'rotate-left', title: 'New conversation' }] : []);
    } catch (err) {
      hosted = false;
    }
    $('app').classList.toggle('hosted-header', Boolean(hosted));
  }
  if (host.header) {
    host.on('header', (e) => { if (e.id === 'new-chat') newChat(); });
  }

  // --- availability: whether this person may use the AI here, and what can save a kept card ---------------------------------

  async function checkAi() {
    try {
      const a = await host.ai.available();
      state.ai = Boolean(a.available);
      state.aiWhy = a.why || '';
    } catch (err) {
      state.ai = false;
      state.aiWhy = `this ${word('module')} has not been approved to use AI (turn it off and on again in Manage > ${word('module', { many: true, cap: true })} and approve it)`;
    }
    hide($('ask-context'), !state.ai);
    hide($('ask-form'), !state.ai);
    hide($('new-chat'), !state.ai);
    syncHeader();
    if (!state.ai) {
      const st = clone('tpl-state-unavailable');
      fill(st, { why: state.aiWhy });
      thread().replaceChildren(st);
      hydrate(thread());
    }
  }
  // A note-shaped save action (a title, a body of text), and a suggestion-shaped one that places a card properly by its `kind`
  // (a title and a kind), each found by name and input shape, never by naming a module.
  async function findSaveAction() {
    try {
      const list = await host.actions.list();
      state.saveAction = list.find((a) => a.name === 'saveNote' && a.input && 'title' in a.input && 'body' in a.input) || null;
      state.suggestAction = list.find((a) => a.name === 'acceptSuggestion' && a.input && 'title' in a.input && 'kind' in a.input) || null;
    } catch (err) {
      state.saveAction = null;
      state.suggestAction = null;
    }
  }

  // --- clicks, and what other modules ask ------------------------------------------------------------------------------------

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action]');
    if (ev.target.closest('#add-context')) { drawPicker(); return hide($('ask-picker'), !$('ask-picker').hidden); }
    if (ev.target.closest('#picker-done')) return hide($('ask-picker'), true);
    if (!t) return;
    if (t.dataset.action === 'remove-context') { const c = t.closest('.ask-chip'); if (c) removeContext(c.dataset.key); }
  });
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('ask-picker').hidden) hide($('ask-picker'), true); });

  // A card the model wrote can be dragged onto another module. Assistant stores nothing, so there is no pointer to
  // drag: its summary travels (title, kind, content, place, date), and the module it lands on offers whatever
  // it can make of that -- "Send all to plan", one card at a time, by hand.
  if (host.objects && host.objects.draggable) {
    host.objects.draggable(root, (target) => {
      const el = target.closest && target.closest('.aicard');
      if (!el || !el.keepCard || target.closest('button, a')) return null;
      const c = el.keepCard;
      return { summary: { title: c.title, kind: c.kind || '', content: c.content || '', place: c.place || null, date: c.date || '' }, label: c.title };
    });
  }
  // Something from another module dropped here: use it as context for the next question, or ask about it at once.
  // A carried summary (another answer) has no pointer and cannot be context; only the modules around can offer for it.
  if (host.objects && host.objects.dropTarget) {
    const showDrop = (yes) => $('app').classList.toggle('drop-target', yes);
    host.objects.dropTarget({
      over: (_pt, ref, dragged) => showDrop(state.ai && Boolean(ref || dragged.summary)),
      leave: () => showDrop(false),
      drop: async (ref, pt, dragged) => {
        showDrop(false);
        if (!state.ai || !(ref || dragged.summary)) return;
        try {
          const asContext = (ctx) => addContext({ ref, title: ctx.summary.title, icon: (ctx.summary.module && ctx.summary.module.icon) || 'note' });
          const own = ref ? [
            { id: 'context', label: 'Use it as context', hint: 'for the next question', run: asContext },
            { id: 'ask', label: 'Ask about it', run: (ctx) => { asContext(ctx); ask(`What should I know about ${ctx.summary.title}?`); } },
          ] : [];
          const chosen = await host.objects.dropMenu(dragged, pt, { context: {}, own, remember: 'pane' });
          if (chosen && chosen.id !== 'context' && chosen.id !== 'ask') say(`${chosen.label}: done`, 3000);
        } catch (err) { say('It could not do that: ' + message(err), 4000); }
      },
    });
  }

  if (host.actions && host.actions.provide) {
    host.actions.provide({
      // A local view: carried out only by the requester's own open Assistant, never someone else's (see module.json). Adds the
      // given object (if any) as context and, with a question, asks it at once.
      askAssistant: async (input) => {
        const i = input || {};
        if (i.ref) {
          try {
            const summary = await host.objects.resolve(i.ref);
            if (summary && !summary.error) addContext({ ref: i.ref, title: summary.title, icon: (summary.module && summary.module.icon) || 'note' });
          } catch (err) { /* not visible here */ }
        }
        if (typeof i.question === 'string' && i.question.trim()) ask(i.question.trim().slice(0, 1000));
        return {};
      },
    });
  }

  $('msg').hidden = true;
  $('app').hidden = false;
  await Promise.all([checkAi(), findSaveAction()]);
  await Promise.all([...root.querySelectorAll('[data-icon]'), ...[...root.querySelectorAll('template')].flatMap((t) => [...t.content.querySelectorAll('[data-icon]')])].map((n) => n.dataset.icon).filter(Boolean).map(wantIcon));
  hydrate(root);
  drawContext();
})();
