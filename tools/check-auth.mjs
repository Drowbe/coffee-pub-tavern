#!/usr/bin/env node
/*
 * check-auth.mjs -- server/auth.js on its own: TOTP (RFC 6238), the secret's own encryption at rest,
 * recovery codes, the pending token, and mfa.version folded into a session's own stamp
 * (documentation/plans/plan-mfa.md). Then the roles (documentation/plans/plan-names.md, step 4): who has an owner's
 * rights and the roles an account can hold, and that the Studio alias is gone (step 10).
 * Last, the server's own settings a person picks from a list: the currency is a known ISO 4217 code (GitHub #4).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const auth = require('../server/auth.js');
const { ROLES, ASSIGNABLE_ROLES, hasOwnerRights } = require('../server/store.js');
const { buildEnvironment, flushEnvironment } = require('../server/environment.js');
let n = 0;
const test = (name, fn) => { fn(); n += 1; };

test('a TOTP secret is base32, and a current code verifies', () => {
  const secret = auth.totpSecret();
  assert.match(secret, /^[A-Z2-7]{30,34}$/);
  const code = auth.totpCode(secret);
  assert.match(code, /^\d{6}$/);
  assert.equal(typeof auth.totpVerify(secret, code), 'number');
});

test('a wrong code, or the wrong shape entirely, is refused', () => {
  const secret = auth.totpSecret();
  assert.equal(auth.totpVerify(secret, '000000'), null);
  assert.equal(auth.totpVerify(secret, 'abcdef'), null);
  assert.equal(auth.totpVerify(secret, ''), null);
  assert.equal(auth.totpVerify(secret, undefined), null);
});

test('one step of drift either way is accepted, two is not', () => {
  const secret = auth.totpSecret();
  const now = Date.now();
  const STEP_MS = 30000;
  const before = auth.totpCode(secret, now - STEP_MS);
  const after = auth.totpCode(secret, now + STEP_MS);
  const tooFarBefore = auth.totpCode(secret, now - 2 * STEP_MS);
  const tooFarAfter = auth.totpCode(secret, now + 2 * STEP_MS);
  assert.equal(typeof auth.totpVerify(secret, before), 'number');
  assert.equal(typeof auth.totpVerify(secret, after), 'number');
  // A code two steps off may coincide with a code inside the accepted window by pure chance (1 in a million);
  // this only ever fails a run in that vanishingly rare case, same tradeoff as testing anything code-based.
  if (tooFarBefore !== before && tooFarBefore !== after) assert.equal(auth.totpVerify(secret, tooFarBefore), null);
  if (tooFarAfter !== before && tooFarAfter !== after) assert.equal(auth.totpVerify(secret, tooFarAfter), null);
});

test('a code already used (at or before lastStep) is refused even when it is otherwise correct', () => {
  const secret = auth.totpSecret();
  const code = auth.totpCode(secret);
  const step = auth.totpVerify(secret, code);
  assert.equal(typeof step, 'number');
  assert.equal(auth.totpVerify(secret, code, step), null); // the same step again
  assert.equal(auth.totpVerify(secret, code, step + 1), null); // a later lastStep still blocks it
  assert.equal(auth.totpVerify(secret, code, step - 1), step); // an earlier lastStep does not
});

test('otpauthUrl carries the issuer, the login and the secret an authenticator app needs', () => {
  const secret = auth.totpSecret();
  const url = auth.otpauthUrl('Acme', 'gm', secret);
  assert.ok(url.startsWith('otpauth://totp/Acme%3Agm?'));
  assert.ok(url.includes(`secret=${secret}`));
  assert.ok(url.includes('algorithm=SHA1'));
  assert.ok(url.includes('digits=6'));
  assert.ok(url.includes('period=30'));
});

test('a secret round-trips through its own encryption, and only with the right key', () => {
  const secret = auth.totpSecret();
  const key = crypto.randomBytes(32);
  const stored = auth.encryptSecret(secret, key);
  assert.match(stored, /^aesgcm\$[0-9a-f]+\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(auth.decryptSecret(stored, key), secret);
  assert.equal(auth.decryptSecret(stored, crypto.randomBytes(32)), null);
  assert.equal(auth.decryptSecret('not encrypted at all', key), null);
});

test('tampering with the stored ciphertext is caught by its own tag, not silently decrypted wrong', () => {
  const key = crypto.randomBytes(32);
  const stored = auth.encryptSecret(auth.totpSecret(), key);
  const [prefix, iv, tag, cipher] = stored.split('$');
  const flipped = `${prefix}$${iv}$${tag}$${cipher.slice(0, -2)}${cipher.slice(-2) === '00' ? '01' : '00'}`;
  assert.equal(auth.decryptSecret(flipped, key), null);
});

test('ten recovery codes, each shown once, letters and digits only, no ambiguous characters', () => {
  const codes = auth.recoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10, 'every code in a batch is distinct');
  for (const code of codes) {
    assert.match(code, /^[a-hj-np-z2-9]{5}-[a-hj-np-z2-9]{5}$/);
  }
});

test('a pending token round-trips, scoped to its own environment and purpose', () => {
  const secret = 'a signing secret';
  const token = auth.issuePending(secret, { userKey: 'u1', env: 'acme', purpose: 'verify' });
  const data = auth.readPending(secret, token, { env: 'acme', purpose: 'verify' });
  assert.deepEqual({ u: data.u, e: data.e, p: data.p }, { u: 'u1', e: 'acme', p: 'verify' });
  assert.equal(auth.readPending(secret, token, { env: 'other', purpose: 'verify' }), null);
  assert.equal(auth.readPending(secret, token, { env: 'acme', purpose: 'enrol' }), null);
  assert.equal(auth.readPending('a different secret', token), null);
  assert.equal(auth.readPending(secret, `${token}x`), null);
});

test('a pending token expires after its own ten minutes', () => {
  const secret = 'a signing secret';
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - 11 * 60000;
    var stale = auth.issuePending(secret, { userKey: 'u1', env: '', purpose: 'enrol' });
  } finally {
    Date.now = realNow;
  }
  assert.equal(auth.readPending(secret, stale), null);
});

test("mfa.version is folded into a session's own stamp, so a reset or a fresh enrolment busts it", () => {
  const secret = 'a signing secret';
  const before = { key: 'u1', passwordHash: 'hash', linkToken: null, mfa: { version: 1 } };
  const after = { key: 'u1', passwordHash: 'hash', linkToken: null, mfa: { version: 2 } };
  const noFactor = { key: 'u1', passwordHash: 'hash', linkToken: null, mfa: null };
  const token = auth.issueSession(secret, before);
  assert.equal(auth.readSession(secret, token, () => before), before);
  assert.equal(auth.readSession(secret, token, () => after), null, 'a version bump (re-enrolling, a reset) invalidates it');
  assert.equal(auth.readSession(secret, token, () => noFactor), null, 'disabling entirely also invalidates it');
});

test('an owner and the host admin\'s stand-in (admin) have an owner\'s rights; a member, a guest and nobody do not', () => {
  assert.deepEqual(ROLES, ['admin', 'owner', 'member']);
  assert.deepEqual(ASSIGNABLE_ROLES, ['owner', 'member'], 'admin comes only from the host (the stand-in) or the server start, never by hand');
  assert.equal(hasOwnerRights({ role: 'owner' }), true);
  assert.equal(hasOwnerRights({ role: 'admin', hostAdmin: true }), true);
  for (const role of ['member', 'guest', 'moderator', 'user', 'viewer', undefined]) assert.equal(hasOwnerRights({ role }), false, String(role));
  assert.equal(hasOwnerRights(null), false);
});

test('the Studio alias is gone (plan-names step 10): no file, and nothing in the server loads it', () => {
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
  assert.equal(fs.existsSync(path.join(server, 'studio-alias.js')), false);
  for (const file of fs.readdirSync(server).filter((f) => f.endsWith('.js'))) {
    assert.equal(/studio-alias|studioAlias/.test(fs.readFileSync(path.join(server, file), 'utf8')), false, file);
  }
});

test('the server currency is a known code; an unknown one is refused, an old one already set is kept', () => {
  const { Store, CURRENCIES } = require('../server/store.js');
  assert.ok(CURRENCIES.has('USD') && CURRENCIES.has('EUR') && CURRENCIES.size > 100, 'the list comes from Intl');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-currency-'));
  try {
    const store = new Store(dir);
    store.updateSettings({ currency: 'eur' });
    assert.equal(store.settings.currency, 'EUR', 'a known code in lower case is stored in upper case');
    assert.throws(() => store.updateSettings({ currency: 'XYZ' }), /XYZ is not a currency this server knows\. Choose one from the list/);
    assert.throws(() => store.updateSettings({ currency: 'euros' }), /three-letter code/);
    assert.equal(store.settings.currency, 'EUR', 'a refused code changes nothing');
    store.data.settings.currency = 'XYZ'; // written by hand, or before this check existed
    store.updateSettings({ currency: 'XYZ', clock: '24' });
    assert.equal(store.settings.currency, 'XYZ', 'saving the page again keeps the old value');
    assert.equal(store.settings.clock, '24');
    assert.throws(() => store.updateSettings({ currency: 'QQQ' }), /QQQ is not a currency/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the currency list (GET /api/currencies, host.locale().currencies) is exactly the codes the server takes', () => {
  const { Store, CURRENCIES } = require('../server/store.js');
  const { currencyCodes } = require('../server/currencies.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-currency-list-'));
  try {
    const store = new Store(dir);
    const list = currencyCodes(store.settings.currency);
    assert.deepEqual(list, [...list].sort(), 'sorted');
    assert.equal(new Set(list).size, list.length, 'no code twice');
    assert.deepEqual(new Set(list), new Set(CURRENCIES), 'with a known code set, the list is the known codes');
    for (const code of list) {
      store.updateSettings({ currency: code });
      assert.equal(store.settings.currency, code, `${code} is on the list, so it saves`);
    }
    for (const code of ['XYZ', 'QQQ', 'AAA']) if (!list.includes(code)) assert.throws(() => store.updateSettings({ currency: code }), /is not a currency this server knows/, `${code} is not on the list, so it is refused`);
    store.data.settings.currency = 'XYZ'; // an old value kept by updateSettings: the list carries it so the picker can show it
    const withOld = currencyCodes(store.settings.currency);
    assert.ok(withOld.includes('XYZ') && withOld.length === list.length + 1);
    store.updateSettings({ currency: 'XYZ' });
    assert.equal(store.settings.currency, 'XYZ');
    assert.deepEqual(currencyCodes(undefined), list, 'nothing set yet: the known codes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// GitHub #16: a refused save changes nothing, not even the good fields sent before the bad one -- in memory, and
// on disk once a later, valid save writes the file.
test('a refused settings, person or space save changes nothing, in memory or on disk after a later save', () => {
  const { Store } = require('../server/store.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-refused-save-'));
  try {
    const store = new Store(dir);
    const onDisk = () => JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
    store.updateSettings({ clock: '12', loginText: 'before', currency: 'USD' });

    // Settings: good fields, then a refused currency (and a refused theme, a refused home icon).
    assert.throws(() => store.updateSettings({ clock: '24', loginText: 'after', environmentName: 'Changed', currency: 'XYZ' }), /XYZ is not a currency this server knows/);
    assert.throws(() => store.updateSettings({ clock: '24', activeThemeId: 'nope' }), /no such theme/);
    assert.throws(() => store.updateSettings({ loginText: 'after', homeIcon: 'not-an-icon' }), /unknown home icon/);
    assert.equal(store.settings.clock, '12', 'the clock sent with a refused currency is not applied');
    assert.equal(store.settings.loginText, 'before');
    assert.notEqual(store.settings.environmentName, 'Changed');
    store.updateSettings({ language: store.settings.language }); // a later, valid save writes the file
    assert.equal(onDisk().settings.clock, '12', 'and not written by the next save');
    assert.equal(onDisk().settings.loginText, 'before');
    const settingsObject = store.settings;
    assert.equal(store.updateSettings({ clock: '24' }), settingsObject, 'an accepted save still updates the same settings object');
    assert.equal(store.settings.clock, '24');

    // A person: a new login and name, then a refused role.
    const bob = store.addUser({ login: 'bob', role: 'member' });
    assert.throws(() => store.updateUser(bob.key, { login: 'robert', displayName: 'Robert', role: 'nonsense' }), /role must be owner or member/);
    assert.equal(store.userByKey(bob.key).login, 'bob');
    assert.equal(store.userByKey(bob.key).displayName, 'bob');
    assert.equal(store.userByLogin('robert'), null);

    // A space: a new name and description, then a refused profile, link or link icon.
    const space = store.addSpace({ name: 'Keep' });
    const guests = Boolean(space.allowGuests);
    assert.throws(() => store.updateSpace(space.id, { name: 'Lost', description: 'lost', profile: 'bad' }), /profile must be roleplaying/);
    assert.throws(() => store.updateSpace(space.id, { name: 'Lost', allowGuests: !guests, link: 'ftp://x' }), /link must be a valid http\(s\) URL/);
    assert.throws(() => store.updateSpace(space.id, { name: 'Lost', linkIcon: 'not-an-icon' }), /unknown link icon/);
    assert.equal(store.spaceById(space.id).name, 'Keep');
    assert.equal(store.spaceById(space.id).description, '');
    assert.equal(Boolean(store.spaceById(space.id).allowGuests), guests);

    store.updateSettings({ clock: '12' });
    const disk = onDisk();
    assert.equal(disk.users.find((u) => u.key === bob.key).login, 'bob');
    assert.equal(disk.spaces.find((r) => r.id === space.id).name, 'Keep');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The server's admin on a single-environment install (plan-names decision 7, amended): buildEnvironment's `admin`, from
// ADMIN_LOGIN and ADMIN_PASSWORD on every start.
test('a single install\'s admin: made, reset only when the password differs, an owner from step 4 made admin again with a password, nobody without one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-auth-admin-'));
  const start = (admin) => {
    const lines = [];
    const env = buildEnvironment(dir, { admin, log: (m) => lines.push(m) });
    env.moduleHooks.stop();
    flushEnvironment(env);
    return { store: env.store, lines };
  };
  try {
    let { store, lines } = start({ login: 'gm', password: 'first-password-1' });
    assert.deepEqual(lines.filter((l) => l.startsWith('Admin')), ['Admin "gm" created from the environment.']);
    const gm = store.userByLogin('gm');
    assert.deepEqual([gm.role, gm.hostAdmin, store.ownerCount()], ['admin', false, 0]);
    assert.ok(auth.verifyPassword('first-password-1', gm.passwordHash));
    const firstHash = gm.passwordHash;
    ({ store, lines } = start({ login: 'gm', password: 'first-password-1' }));
    assert.equal(store.userByLogin('gm').passwordHash, firstHash, 'the same password: not rewritten, so no session is signed out');
    assert.deepEqual(lines.filter((l) => l.startsWith('Admin')), []);
    ({ store, lines } = start({ login: 'gm', password: 'second-password-1' }));
    assert.ok(auth.verifyPassword('second-password-1', store.userByLogin('gm').passwordHash), 'a new password: reset');
    assert.deepEqual(lines.filter((l) => l.startsWith('Admin')), ['Admin "gm" updated from the environment.']);
    // As step 4 left an install: the compose account an owner. The next start makes it admin, with or without a password.
    store.addUser({ login: 'olive', role: 'owner', passwordHash: 'x' });
    const app = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
    app.users.find((u) => u.login === 'gm').role = 'owner';
    fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(app));
    ({ store } = start({ login: 'gm', password: 'second-password-1' }));
    assert.deepEqual(['gm', 'olive'].map((l) => store.userByLogin(l).role), ['admin', 'owner'], 'the admin again; other owners stay owners');
    app.users.find((u) => u.login === 'gm').role = 'owner';
    fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(app));
    ({ store, lines } = start({ login: 'gm', password: undefined }));
    assert.equal(store.userByLogin('gm').role, 'owner', 'with no password set, accounts there: nobody is promoted');
    assert.deepEqual(lines, ['This install has no server admin. Set ADMIN_LOGIN and ADMIN_PASSWORD, then restart, to have one.']);
    store.addUser({ login: 'pat', passwordHash: 'x' });
    ({ store } = start({ login: 'pat', password: undefined }));
    assert.equal(store.userByLogin('pat').role, 'member', 'a member is never made admin without a password');
    ({ store, lines } = start({ login: 'pat', password: 'pat-password-1' }));
    assert.equal(store.userByLogin('pat').role, 'admin', 'with ADMIN_PASSWORD, the account ADMIN_LOGIN names is the admin, as it always was');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with no ADMIN_PASSWORD, a random one is made and logged once, the first time there is no admin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-auth-admin-'));
  try {
    const lines = [];
    let env = buildEnvironment(dir, { admin: { login: 'admin' }, log: (m) => lines.push(m) });
    env.moduleHooks.stop();
    const made = /^No admin yet and no ADMIN_PASSWORD set\. Created "admin" with password: (\S+)$/.exec(lines.find((l) => l.startsWith('No admin')) || '');
    assert.ok(made, lines.join('\n'));
    assert.ok(auth.verifyPassword(made[1], env.store.userByLogin('admin').passwordHash));
    assert.equal(env.store.userByLogin('admin').role, 'admin');
    flushEnvironment(env);
    lines.length = 0;
    env = buildEnvironment(dir, { admin: { login: 'admin' }, log: (m) => lines.push(m) });
    env.moduleHooks.stop();
    flushEnvironment(env);
    assert.deepEqual(lines.filter((l) => /admin/i.test(l)), [], 'the next start has an admin already: nothing to say');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`check-auth: ${n} groups OK`);
