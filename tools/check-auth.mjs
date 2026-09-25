#!/usr/bin/env node
/*
 * check-auth.mjs -- server/auth.js on its own: TOTP (RFC 6238), the secret's own encryption at rest,
 * recovery codes, the pending token, and mfa.version folded into a session's own stamp
 * (documentation/plans/plan-mfa.md). Then the roles (documentation/plans/plan-names.md, step 4): who has an owner's
 * rights, the roles an account can hold, and the old role values the Studio alias answers a bearer request with.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const auth = require('../server/auth.js');
const { ROLES, ASSIGNABLE_ROLES, hasOwnerRights } = require('../server/store.js');
const studioAlias = require('../server/studio-alias.js');
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
  assert.deepEqual(ASSIGNABLE_ROLES, ['owner', 'member'], 'admin comes only with the stand-in, never by hand');
  assert.equal(hasOwnerRights({ role: 'owner' }), true);
  assert.equal(hasOwnerRights({ role: 'admin', hostAdmin: true }), true);
  for (const role of ['member', 'guest', 'moderator', 'user', 'viewer', undefined]) assert.equal(hasOwnerRights({ role }), false, String(role));
  assert.equal(hasOwnerRights(null), false);
});

test('the Studio alias answers a bearer request with the old role values, and the pages\' cookie with the new', () => {
  const req = (headers) => ({ get: (name) => headers[name.toLowerCase()] });
  const bearer = req({ authorization: 'Bearer good' });
  const cookie = req({ cookie: 'session=x' });
  assert.deepEqual(['owner', 'admin', 'member', 'guest'].map(studioAlias.oldRole), ['admin', 'admin', 'user', 'guest']);
  const me = (role) => ({ user: { key: 'k', role }, streamKey: role === 'member' ? undefined : 'sk' });
  const ctx = { signedIn: { key: 'k' }, environmentName: 'Ours' };
  assert.equal(studioAlias.me(bearer, me('owner'), ctx).user.role, 'admin');
  assert.equal(studioAlias.me(bearer, me('owner'), ctx).streamKey, 'sk', 'the stream key rides along unchanged');
  assert.equal(studioAlias.me(bearer, me('admin'), ctx).user.role, 'admin');
  assert.equal(studioAlias.me(bearer, me('member'), ctx).user.role, 'user');
  const answer = me('owner');
  assert.equal(studioAlias.me(cookie, answer, ctx), answer, 'a cookie request: the very same answer');
  const status = { users: [{ key: 'a', role: 'owner' }, { key: 'b', role: 'member' }, { key: 'c', role: 'admin' }] };
  assert.deepEqual(studioAlias.status(bearer, status, ctx).users.map((u) => u.role), ['admin', 'user', 'admin']);
  assert.deepEqual(status.users.map((u) => u.role), ['owner', 'member', 'admin'], 'the answer itself is not changed in place');
  assert.equal(studioAlias.status(cookie, status, ctx), status);
  assert.equal(studioAlias.status(req({ authorization: 'Bearer junk' }), status, { signedIn: null }), status, 'a bearer header that signed nobody in (the stream key let it in)');
});

console.log(`check-auth: ${n} groups OK`);
