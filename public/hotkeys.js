// A small cross-platform keyboard-shortcut format shared by the profile
// page (recording a combo) and the space (matching one live during a call).
// Stored and sent to the server as strings like "Mod+KeyD": "Mod" is Cmd on
// a Mac and Ctrl everywhere else, the same convention most cross-platform
// apps use, so a shortcut picked on one OS still reads and works sensibly
// if the same account ever signs in from another. A real Ctrl held on a
// Mac (a different key from Cmd there) is kept literal instead of folded
// into Mod, so it stays a distinct combo rather than silently colliding.

export const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

function parse(combo) {
  const parts = String(combo || '').split('+').filter(Boolean);
  const code = parts.pop() || '';
  return { code, mod: parts.includes('Mod'), ctrl: parts.includes('Ctrl'), meta: parts.includes('Meta'), alt: parts.includes('Alt'), shift: parts.includes('Shift') };
}

// Turns a keydown event into the same string this module stores and
// matches, or null while only a modifier is held (the real key hasn't
// landed yet, keep waiting).
export function comboFromEvent(event) {
  if (!event.code || /^(Control|Meta|Alt|Shift)(Left|Right)?$/.test(event.code)) return null;
  const mods = [];
  if (isMac ? event.metaKey : event.ctrlKey) mods.push('Mod');
  else {
    if (event.ctrlKey) mods.push('Ctrl');
    if (event.metaKey) mods.push('Meta');
  }
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  return [...mods, event.code].join('+');
}

export function hotkeyMatches(event, combo) {
  const h = parse(combo);
  if (!h.code || event.code !== h.code) return false;
  const wantCtrl = h.ctrl || (h.mod && !isMac);
  const wantMeta = h.meta || (h.mod && isMac);
  return event.ctrlKey === wantCtrl && event.metaKey === wantMeta && event.altKey === h.alt && event.shiftKey === h.shift;
}

function codeLabel(code) {
  const key = /^Key([A-Z])$/.exec(code); if (key) return key[1];
  const digit = /^Digit([0-9])$/.exec(code); if (digit) return digit[1];
  const named = { Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
  return named[code] || code;
}

// A readable label for a combo: Mac symbols in Mac's own order, word form
// with "Ctrl+" elsewhere -- the same shape Google Meet's own shortcuts use.
export function formatHotkey(combo) {
  const h = parse(combo);
  if (!h.code) return 'unset';
  if (isMac) {
    let out = '';
    if (h.ctrl) out += '⌃';
    if (h.mod || h.meta) out += '⌘';
    if (h.alt) out += '⌥';
    if (h.shift) out += '⇧';
    return out + codeLabel(h.code);
  }
  const parts = [];
  if (h.mod || h.ctrl) parts.push('Ctrl');
  if (h.meta) parts.push('Win');
  if (h.alt) parts.push('Alt');
  if (h.shift) parts.push('Shift');
  parts.push(codeLabel(h.code));
  return parts.join('+');
}
