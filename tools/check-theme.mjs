#!/usr/bin/env node
/*
 * check-theme.mjs -- light and dark (GitHub #62): /theme.css carries both of the live theme's sets, each under its
 * own <html data-theme-mode>, the default one also covering a page without the attribute (server/theme-css.js); a
 * person's own mode is kept on their account (Store.setThemeMode), absent while they follow the environment's
 * default; and a bad mode, the owner's or a person's, is refused and changes nothing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { themeCss, themeVersion } = require('../server/theme-css.js');
const { Store } = require('../server/store.js');
let n = 0;
const test = (name, fn) => {
  try {
    fn();
    n += 1;
  } catch (err) {
    console.error(`check-theme: ${name}`);
    throw err;
  }
};
const withStore = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-theme-'));
  try {
    fn(new Store(dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const LIGHT = { bg: '#ffffff', bgSection: '#f7f7f7', border: '#e0e0e0', text: '#333333', textDim: '#767676', accent: '#e45628', onAccent: '#ffffff', headerBg: '#eeeeee' };
const DARK = { bg: '#111111', bgSection: '#222222', border: '#333333', text: '#eeeeee', textDim: '#999999', accent: '#e45628', onAccent: '#ffffff' };

test('both sets are sent, each under its own selector, the default one also covering no attribute', () => {
  const css = themeCss({ light: LIGHT, dark: DARK }, 'dark');
  assert.match(css, /:root:not\(\[data-theme-mode="light"\]\) \{[^}]*--bg: #111111;/);
  assert.match(css, /:root\[data-theme-mode="light"\] \{[^}]*--bg: #ffffff;/);
  const flipped = themeCss({ light: LIGHT, dark: DARK }, 'light');
  assert.match(flipped, /:root:not\(\[data-theme-mode="dark"\]\) \{[^}]*--bg: #ffffff;/);
  assert.match(flipped, /:root\[data-theme-mode="dark"\] \{[^}]*--bg: #111111;/);
});

test('an optional color one mode sets stays in that mode', () => {
  const css = themeCss({ light: LIGHT, dark: DARK }, 'light');
  const dark = /:root\[data-theme-mode="dark"\] \{([^}]*)\}/.exec(css)[1];
  assert.doesNotMatch(dark, /--header-bg/);
  assert.match(css, /--header-bg: #eeeeee;/);
});

test('a null set (style.css\'s own palette) writes nothing; an odd default mode reads as dark', () => {
  const css = themeCss({ light: LIGHT, dark: null }, 'nonsense');
  assert.doesNotMatch(css, /:root:not/);
  assert.match(css, /:root\[data-theme-mode="light"\]/);
  assert.notEqual(themeVersion({ light: LIGHT, dark: null }, 'dark'), themeVersion({ light: LIGHT, dark: null }, 'light'));
});

test('an untouched environment: Strong Coffee, its dark set left to style.css and its light set sent', () => withStore((store) => {
  const sets = store.activeThemeSets();
  assert.equal(sets.dark, null);
  assert.equal(sets.light.bg, '#faf6f1');
  assert.equal(store.settings.themeMode, 'dark');
}));

test('a theme with one set shows it in both modes', () => withStore((store) => {
  const theme = store.addTheme({ name: 'One', mode: 'light', ...LIGHT });
  store.updateSettings({ activeThemeId: theme.id });
  const sets = store.activeThemeSets();
  assert.equal(sets.light.bg, '#ffffff');
  assert.equal(sets.dark.bg, '#ffffff');
}));

test("the owner's default mode: light or dark only; anything else is refused and nothing changes", () => withStore((store) => {
  store.updateSettings({ themeMode: 'light' });
  assert.equal(store.settings.themeMode, 'light');
  assert.throws(() => store.updateSettings({ environmentName: 'Changed', themeMode: 'purple' }), /the mode is light or dark/);
  assert.equal(store.settings.themeMode, 'light');
  assert.notEqual(store.settings.environmentName, 'Changed');
}));

test("a person's own mode is kept on the account, survives a reload, and null follows the default again", () => withStore((store, dir) => {
  const user = store.addUser({ login: 'pat', role: 'member' });
  assert.equal(user.themeMode, undefined);
  assert.equal(store.setThemeMode(user.key, 'dark'), 'dark');
  assert.equal(store.setThemeMode(user.key, 'light'), 'light');
  store.save();
  const again = new Store(dir);
  assert.equal(again.userByKey(user.key).themeMode, 'light');
  assert.equal(again.setThemeMode(user.key, null), null);
  assert.equal('themeMode' in again.userByKey(user.key), false);
}));

test("a bad mode for a person is refused and changes nothing; an unknown account is a 404", () => withStore((store) => {
  const user = store.addUser({ login: 'sam', role: 'member' });
  store.setThemeMode(user.key, 'dark');
  for (const bad of ['Light', 'purple', '', 1, true, undefined, {}]) {
    assert.throws(() => store.setThemeMode(user.key, bad), /the mode is light or dark/);
  }
  assert.equal(store.userByKey(user.key).themeMode, 'dark');
  assert.throws(() => store.setThemeMode('nosuchkey', 'dark'), (err) => err.status === 404);
}));

test('a stored mode that is not light or dark is dropped on load', () => withStore((store, dir) => {
  const user = store.addUser({ login: 'lee', role: 'member' });
  store.save();
  const file = path.join(dir, 'app.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.users.find((u) => u.key === user.key).themeMode = 'sepia';
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal('themeMode' in new Store(dir).userByKey(user.key), false);
}));

console.log(`check-theme: ${n} checks passed`);
