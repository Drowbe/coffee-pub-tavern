  // Assistant's model. Assistant keeps no items of its own (see CONTRACT.md), so there is little to test in isolation: parsing an
  // AI reply into the pieces to draw, and what to ask a note-shaped save action to keep a card. The page defines `geo` (host.util.geo)
  // ahead of this code, as the check does.

  // An AI answer as the pieces to draw, in order: { text } and { card: index }. A marker {{card:N}} counts only when N is a real card
  // that has not been drawn yet; any other stays as the text it is. A card the text never mentions goes after it.
  function answerParts(text, cardCount) {
    const parts = [];
    const drawn = new Set();
    let last = 0;
    const re = /\{\{card:(\d+)\}\}/g;
    let m;
    const push = (s) => { const t = s.trim(); if (t) parts.push({ text: t }); };
    const src = String(text || '');
    while ((m = re.exec(src))) {
      const n = Number(m[1]);
      if (!(n < cardCount) || drawn.has(n)) continue;
      push(src.slice(last, m.index));
      parts.push({ card: n });
      drawn.add(n);
      last = m.index + m[0].length;
    }
    push(src.slice(last));
    for (let i = 0; i < cardCount; i += 1) if (!drawn.has(i)) parts.push({ card: i });
    return parts;
  }

  // What to ask a note-shaped save action (saveNote-like: a title, a body of text, and one optional pointer) to keep a card. The
  // action bus carries no list of tags or several pointers as its own types, so tags travel as one comma-separated string (as the
  // person's own tags field would read them) and, when the card names more than one source, only the question and their names are
  // folded into the body as a plain, readable line; a single source is passed on as the note's `ref` so it stays a live pointer.
  // `sourceLabel(ref)` names one source; asked with no question or sources, only the content comes through.
  function keepInput(card, question, sourceLabel) {
    const lines = [String((card && card.content) || '').trim()];
    const q = String(question || '').trim();
    const sources = (card && card.sources) || [];
    const names = sources.map(sourceLabel).filter(Boolean);
    if (q) lines.push('', `Asked: ${q}`);
    if (names.length) lines.push(`From: ${names.join(', ')}`);
    return {
      title: geo.oneLine((card && card.title) || '', 120) || 'Untitled',
      body: lines.join('\n').trim(),
      tags: ((card && card.tags) || []).join(', '),
      ...(sources.length === 1 ? { ref: sources[0] } : {}),
    };
  }
