// /theme.css, both modes at once (GitHub #62): the live theme's light set and its dark set, each under its own
// selector on <html>, so a page switches mode by setting one attribute -- no second request, no reload.
//
//   <html data-theme-mode="light">  the light set
//   <html data-theme-mode="dark">   the dark set
//   <html> (no attribute)           the default mode: the signed-in person's own choice, else the environment's
//
// The two selectors never both match, so a color one mode sets (an optional one such as --header-bg) can't leak
// into the other: whatever a set leaves out falls through to style.css's own :root, the same as before. A set that
// is null (Strong Coffee's dark set, which is style.css's own palette) writes nothing at all.
const crypto = require('crypto');

const MODES = ['light', 'dark'];
const isMode = (mode) => MODES.includes(mode);

// Theme color key -> the CSS custom property it sets. Optional ones only when the theme sets them.
const VARS = [
  ['bg', '--bg'],
  ['bgSection', '--bg-section'],
  ['border', '--border'],
  ['text', '--text'],
  ['textDim', '--text-dim'],
  ['accent', '--accent'],
  ['onAccent', '--on-accent'],
  ['card', '--bg-card'],
  ['headerBg', '--header-bg'],
  ['headerText', '--header-text'],
  ['icon', '--icon'],
  ['iconHover', '--icon-hover'],
  ['primaryHover', '--primary-hover'],
  ['secondary', '--secondary'],
  ['secondaryText', '--secondary-text'],
  ['secondaryHover', '--secondary-hover'],
];

function block(selector, colors) {
  const lines = colors ? VARS.filter(([key]) => colors[key]).map(([key, name]) => `  ${name}: ${colors[key]};`) : [];
  return lines.length ? `${selector} {\n${lines.join('\n')}\n}\n` : '';
}

// sets: { light, dark } (either may be null: style.css's own); defaultMode: which one a page without the attribute
// shows. The default mode's selector is ":not(the other mode)", so it covers the bare <html> too.
function themeCss(sets, defaultMode) {
  const def = isMode(defaultMode) ? defaultMode : 'dark';
  const other = def === 'light' ? 'dark' : 'light';
  return `/* default mode: ${def} */\n`
    + block(`:root:not([data-theme-mode="${other}"])`, sets?.[def])
    + block(`:root[data-theme-mode="${other}"]`, sets?.[other]);
}

// A short fingerprint of what the environment's /theme.css says (not a person's default): changes whenever the
// owner's theme, its colors or the default mode change, so a page can tell a stale stylesheet from a fresh one.
function themeVersion(sets, defaultMode) {
  return crypto.createHash('sha256').update(themeCss(sets, defaultMode)).digest('hex').slice(0, 12);
}

module.exports = { MODES, isMode, themeCss, themeVersion };
