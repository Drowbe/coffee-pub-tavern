  // Assistant's model. Assistant keeps no objects of its own (see CONTRACT.md), so there is little to test in isolation: parsing an
  // AI reply into the pieces to draw, and what to ask a note-shaped save action to keep an answer's summary. The page defines `geo` (host.util.geo)
  // ahead of this code, as the check does.

  // An AI answer as the pieces to draw, in order: { text } and { summary: index }. A marker {{summary:N}} counts only when N is a
  // real summary that has not been drawn yet; any other stays as the text it is. A summary the text never mentions goes after it.
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

  // The text kept for an object: its content, then (for an answer) Asked/From, then its links, then (for an import)
  // "External source". At most 8000 characters: the content is shortened first, every other part stays whole.
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
    const max = 8000;
    if (content.length + suffix.length > max) {
      content = content.slice(0, Math.max(0, max - suffix.length - 1)) + '…';
    }
    return content + suffix;
  }

  // What to ask a note-shaped save action (saveNote-like: a title, a body of text, and one optional pointer) to keep an answer's summary. The
  // action bus carries no list of tags or several pointers as its own types, so tags travel as one comma-separated string (as the
  // person's own tags field would read them) and, when the summary names more than one source, only the question and their names are
  // folded into the body as a plain, readable line; a single source is passed on as the note's `ref` so it stays a live pointer.
  // `sourceLabel(ref)` names one source; asked with no question or sources, only the content comes through.
  function keepInput(summary, question, sourceLabel) {
    const sources = (summary && summary.sources) || [];
    const names = sources.map(sourceLabel).filter(Boolean);
    return {
      title: geo.oneLine((summary && summary.title) || '', 120) || 'Untitled',
      body: keptText(summary, { question, sourceNames: names }),
      tags: ((summary && summary.tags) || []).join(', '),
      ...(sources.length === 1 ? { ref: sources[0] } : {}),
    };
  }

  function suggestionInput(summary, question, sourceLabel) {
    const sources = (summary && summary.sources) || [];
    const names = typeof sourceLabel === 'function' ? sources.map(sourceLabel).filter(Boolean) : [];
    return {
      title: geo.oneLine((summary && summary.title) || '', 120) || 'Untitled',
      kind: (summary && summary.kind) || '',
      content: keptText(summary, { question, sourceNames: names }),
      place: (summary && summary.place && summary.place.name) || '',
      date: (summary && summary.date) || '',
    };
  }
