  // The Research module's model: no page in it, so the page and the checks can both use it. An item is one stored value, kept under
  // `<kind>:<id>` (note, link, photo or answer):
  //   { kind, title, body|excerpt|content (by kind), text, sub, url, site, tags, date, point?, file?, by, at, ai? }
  // `text` is the item's plain words (what the AI reads and a card carries), `sub` its subtitle (a link's site), `date` a day
  // (YYYY-MM-DD) or '', `point` a place on a map, `file` a photo's picture ({ id, hasThumb }), `ai` an answer's { question, sources }.
  // The page defines `geo` (host.util.geo) ahead of this code, as the check does.
  const KINDS = ['note', 'link', 'photo', 'answer'];
  const KIND_LABEL = { note: 'Note', link: 'Link', photo: 'Photo', answer: 'Answer' };
  const KIND_ICON = { note: 'note-sticky', link: 'link', photo: 'camera', answer: 'wand-magic-sparkles' };

  const plainText = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}(?<!\n)/gu, ' ').slice(0, n);
  const isDay = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  };

  // Tags are plain words, lower case, one word each (letters, digits and dashes), at most 8 to an item.
  function cleanTags(list) {
    const out = [];
    for (const t of Array.isArray(list) ? list : []) {
      const tag = String(t == null ? '' : t).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 24);
      if (tag && !out.includes(tag)) out.push(tag);
      if (out.length >= 8) break;
    }
    return out;
  }
  // What was typed in the tags field: words separated by commas or spaces ("#hotel, lisbon").
  const parseTags = (text) => cleanTags(String(text || '').split(/[\s,;]+/));

  // A web address (http or https only, no user name or password), or null.
  function cleanUrl(text) {
    let u;
    try { u = new URL(String(text || '').trim()); } catch (err) { return null; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.href.length > 500) return null;
    return u.href;
  }
  const siteOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (err) { return ''; } };

  // The fields that belong to a kind, and the one that holds its words.
  const BODY_FIELD = { note: 'body', link: 'excerpt', photo: 'title', answer: 'content' };

  // A stored value as an item, or null when it is not one.
  function cleanItem(kind, id, v) {
    if (!KINDS.includes(kind) || !v || typeof v !== 'object') return null;
    let title = geo.oneLine(v.title, 120);
    const url = kind === 'link' ? cleanUrl(v.url) : null;
    if (kind === 'link' && !url) return null;
    if (!title && kind === 'link') title = siteOf(url);
    if (!title && kind === 'note') title = geo.oneLine(String(v.body || '').split('\n')[0], 120);
    if (!title && kind === 'photo') title = 'Photo';
    if (!title) return null;
    const item = {
      id: String(id),
      kind,
      title,
      body: kind === 'note' ? plainText(v.body, 8000) : '',
      excerpt: kind === 'link' ? plainText(v.excerpt, 2000) : '',
      content: kind === 'answer' ? plainText(v.content, 8000) : '',
      url: url || '',
      site: url ? siteOf(url) : '',
      tags: cleanTags(v.tags),
      date: isDay(v.date) ? v.date : '',
      point: null,
      file: null,
      by: typeof v.by === 'string' ? v.by.slice(0, 64) : '',
      at: typeof v.at === 'string' ? v.at.slice(0, 32) : '',
      ai: null,
    };
    if (v.point && typeof v.point === 'object') {
      const lat = Number(v.point.lat);
      const lng = Number(v.point.lng);
      if (geo.inRange(lat, lng)) item.point = { lat: geo.round6(lat), lng: geo.round6(lng), ...(typeof v.point.name === 'string' && v.point.name.trim() ? { name: geo.oneLine(v.point.name, 120) } : {}) };
    }
    if (kind === 'photo' && v.file && typeof v.file.id === 'string' && /^[a-f0-9]{24}$/.test(v.file.id)) item.file = { id: v.file.id, hasThumb: v.file.hasThumb === true };
    if (kind === 'photo' && !item.file) return null;
    if (kind === 'answer' && v.ai && typeof v.ai === 'object') {
      const sources = (Array.isArray(v.ai.sources) ? v.ai.sources : []).filter((r) => r && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string').slice(0, 12)
        .map((r) => ({ module: r.module.slice(0, 40), kind: r.kind.slice(0, 40), id: r.id.slice(0, 64), ...(typeof r.scope === 'string' ? { scope: r.scope.slice(0, 10) } : {}), ...(typeof r.room === 'string' ? { room: r.room.slice(0, 20) } : {}), ...(typeof r.label === 'string' ? { label: geo.oneLine(r.label, 80) } : {}) }));
      item.ai = { question: geo.oneLine(v.ai.question, 1000), sources };
    }
    return item;
  }
  // The plain words of an item, for a search and for the AI.
  const textOf = (it) => (it.kind === 'photo' ? it.title : it[BODY_FIELD[it.kind]] || '');
  // What is stored for an item: only what its kind uses, plus the derived `text` and `sub` its card carries.
  function itemValue(it) {
    const v = { kind: it.kind, title: it.title, tags: it.tags, date: it.date, by: it.by, at: it.at, text: textOf(it), sub: it.kind === 'link' ? it.site : '' };
    if (it.kind === 'note') v.body = it.body;
    if (it.kind === 'link') { v.url = it.url; v.excerpt = it.excerpt; }
    if (it.kind === 'answer') { v.content = it.content; if (it.ai) v.ai = it.ai; }
    if (it.kind === 'photo' && it.file) v.file = it.file;
    if (it.point) v.point = it.point;
    return v;
  }

  // What was typed into the quick-add field: a web address alone is a link (its title and note are for the person to fill in);
  // anything else is a note whose title is its first line and whose body is the rest (or, for one short line, nothing).
  function readEntry(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const url = /^\S+$/.test(t) ? cleanUrl(t) : null;
    if (url) return { kind: 'link', url, title: '', excerpt: '' };
    const lines = t.split('\n');
    const first = geo.oneLine(lines[0], 120);
    const rest = lines.slice(1).join('\n').trim();
    const pt = geo.parsePoint(first);
    return { kind: 'note', title: pt ? '' : first, body: rest || (first.length > 120 ? t : ''), point: pt || null };
  }

  // Search text, a kind and tags (all of them) over the items, newest first.
  function filterItems(items, { q, kind, tags }) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const need = (tags || []).filter(Boolean);
    return items
      .filter((it) => (!kind || it.kind === kind) && need.every((t) => it.tags.includes(t)) && words.every((w) => `${it.title} ${textOf(it)} ${it.site} ${it.tags.join(' ')}`.toLowerCase().includes(w)))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.title.localeCompare(b.title));
  }
  // The tags in use, most used first: [{ tag, count }].
  function tagCounts(items) {
    const n = new Map();
    for (const it of items) for (const t of it.tags) n.set(t, (n.get(t) || 0) + 1);
    return [...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  // The size a picture is scaled to so its long edge is at most `max`, never bigger than it is.
  function fitSize(w, h, max) {
    const scale = Math.min(1, max / Math.max(w, h, 1));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }
  // A caption from a file name: "IMG_2041.jpg" -> "IMG 2041".
  const captionOf = (name) => geo.oneLine(String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' '), 120);

  // The items of one scope ('room' or 'person'), kept live, and what other modules may ask of them. `host` is the SDK.
  function createResearch(host, opts) {
    const scope = (opts && opts.scope) || 'room';
    const at = { scope };
    const items = new Map(); // id -> { item, version }
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) fn(); };
    const split = (key) => { const i = String(key).indexOf(':'); return [String(key).slice(0, i), String(key).slice(i + 1)]; };

    const remember = (key, value, version) => {
      const [kind, id] = split(key);
      const it = value ? cleanItem(kind, id, value) : null;
      if (it) items.set(id, { item: it, version });
      else items.delete(id);
    };
    async function load() {
      items.clear();
      for (const kind of KINDS) for (const it of await host.storage.list(`${kind}:`, at)) remember(it.key, it.value, it.version);
      changed();
    }
    host.on('change', (e) => {
      if (e.scope === 'rooms' || (e.scope || 'room') !== scope) return;
      const [kind] = split(e.key);
      if (!KINDS.includes(kind)) return;
      remember(String(e.key), e.deleted ? null : e.value, e.version);
      changed();
    });

    const list = () => [...items.values()].map((x) => x.item);
    const get = (id) => (items.get(id) || {}).item || null;
    const versionOf = (id) => (items.get(id) || {}).version;
    const refOf = (kind, id) => host.refs.make(kind, id, scope === 'person' ? { scope: 'person' } : undefined);

    // Save an item (a new one when it has no id). A stale edit is refused with the store's 409.
    async function save(p, version) {
      const id = p.id && p.id !== 'new' ? p.id : host.util.id();
      const item = cleanItem(p.kind, id, { ...p, by: p.by, at: p.at || new Date().toISOString() });
      if (!item) throw new Error('that is not a whole item');
      const saved = await host.storage.set(`${item.kind}:${id}`, itemValue(item), version === undefined ? at : { ...at, version });
      items.set(id, { item, version: saved && saved.version });
      changed();
      return item;
    }
    // Remove an item and, for a photo, its picture. Whoever cannot remove the file (someone else's) still removes the item.
    async function remove(id) {
      const cur = items.get(id);
      if (!cur) return;
      await host.storage.delete(`${cur.item.kind}:${id}`, { ...at, version: cur.version });
      items.delete(id);
      if (cur.item.file) host.uploads.remove(cur.item.file.id, at).catch(() => {});
      if (scope !== 'person') host.refs.setLinks(refOf(cur.item.kind, id), []).catch(() => {});
      changed();
    }

    // What other modules may ask of this one: save a note or a link, optionally about an item of theirs.
    function provide(me) {
      if (!host.actions || !host.actions.provide) return;
      const link = (item, ref) => { if (ref && scope !== 'person') host.refs.setLinks(refOf(item.kind, item.id), [ref]).catch(() => {}); };
      host.actions.provide({
        // tags is a plain comma- or space-separated string, as the field in the dialog reads it, so any module (or Assistant,
        // keeping a card) can offer tags without knowing this module's shape.
        saveNote: async (input, ctx) => {
          const i = input || {};
          const title = geo.oneLine(i.title, 120);
          if (!title) throw new Error('a note needs a title');
          const item = await save({ kind: 'note', title, body: plainText(i.body, 8000), tags: parseTags(i.tags), date: '', by: me || (ctx && ctx.by) || '' });
          link(item, i.ref);
          return { ref: refOf('note', item.id) };
        },
        saveLink: async (input, ctx) => {
          const i = input || {};
          const url = cleanUrl(i.url);
          if (!url) throw new Error('that is not a web address');
          const item = await save({ kind: 'link', url, title: geo.oneLine(i.title, 120), excerpt: plainText(i.excerpt, 2000), tags: [], date: '', by: me || (ctx && ctx.by) || '' });
          link(item, i.ref);
          return { ref: refOf('link', item.id) };
        },
      });
    }

    return { load, list, get, versionOf, save, remove, provide, refOf, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  }
