'use strict';

// Passwords, sessions and request authentication.
//
// Sessions are signed cookies (no server-side session table): the cookie
// carries the user key and the issue time, plus an HMAC over both. Logging
// out just clears the cookie. Deleting a user or changing their password
// invalidates their sessions because the signature covers a per-user stamp.

const crypto = require('crypto');

const COOKIE = 'app_session';
// The cookie's old name, from before the rename: read as a fallback so an existing session survives it, never
// written again -- setSessionCookie always sets the new name, and clearSessionCookie clears both.
const LEGACY_COOKIE = 'tavern_session';
// The host admin's own session -- a separate cookie, never a tenant's, so the two can never be confused even on
// the same browser (the host console and an environment are different subdomains anyway; this is belt and braces).
const HOST_COOKIE = 'host_session';
const SESSION_DAYS = 30;
// Two-step sign-in (documentation/plans/plan-mfa.md): the short-lived cookie carrying which person is mid-way
// through the second step (PENDING_MINUTES), and the "remember this browser" cookie (TRUST_COOKIE) that skips
// it next time -- same shape and lifetime as a real session (see issueSession/readSession below, reused for
// it directly), just under its own name so it can never be mistaken for one.
const PENDING_COOKIE = 'mfa_pending';
const TRUST_COOKIE = 'mfa_trust';
const PENDING_MINUTES = 10;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(String(password), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
}

// Per-user stamp folded into the session signature, so a password change, a link regeneration, or a second
// factor being enrolled, reset or newly required (mfa.version, folded in here too -- documentation/plans/
// plan-mfa.md) logs the user out everywhere, trusted browsers included (mfa_trust is issued and read with
// this same function, see TRUST_COOKIE below).
function userStamp(user) {
  return crypto.createHash('sha256').update(`${user.passwordHash || ''}|${user.linkToken || ''}|${user.mfa?.version || 0}`).digest('hex').slice(0, 16);
}

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function issueSession(secret, user) {
  const payload = Buffer.from(JSON.stringify({ u: user.key, s: userStamp(user), t: Date.now() })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

function readSession(secret, token, lookup) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(secret, payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  if (typeof data.t !== 'number' || Date.now() - data.t > SESSION_DAYS * 86400000) return null;
  const user = lookup(data.u);
  if (!user || userStamp(user) !== data.s) return null;
  return user;
}

// The pending token (documentation/plans/plan-mfa.md, "The pending step"): issued once the first factor
// succeeds but a second is still owed, naming who, at which environment (so a token from one can never be
// replayed at another, even if it somehow reached the wrong cookie jar) and what for (`verify`, an existing
// factor, or `enrol`, none yet but the policy requires one). Ten minutes, not thirty days -- a much shorter
// version of issueSession/readSession's own signed-payload shape, not the same function, since the payload
// and the lifetime both differ.
function issuePending(secret, { userKey, env, purpose }) {
  const payload = Buffer.from(JSON.stringify({ u: userKey, e: env || '', p: purpose, t: Date.now() })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}
function readPending(secret, token, { env, purpose } = {}) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(secret, payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof data.t !== 'number' || Date.now() - data.t > PENDING_MINUTES * 60000) return null;
  if (env !== undefined && data.e !== (env || '')) return null;
  if (purpose !== undefined && data.p !== purpose) return null;
  return data; // { u, e, p, t }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch (err) {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

function isSecure(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

function setSessionCookie(req, res, token, cookieName = COOKIE) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    maxAge: SESSION_DAYS * 86400000,
    path: '/',
  });
}

function clearSessionCookie(req, res, cookieName = COOKIE) {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), path: '/' });
  if (cookieName === COOKIE) res.clearCookie(LEGACY_COOKIE, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), path: '/' });
}

// A pending token's own cookie, ten minutes rather than thirty days -- setSessionCookie's maxAge is fixed to
// SESSION_DAYS regardless of cookieName, so this is its own function rather than a call to it. Cleared the
// same way any cookie is, with clearSessionCookie(req, res, PENDING_COOKIE).
function setPendingCookie(req, res, token) {
  res.cookie(PENDING_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), maxAge: PENDING_MINUTES * 60000, path: '/' });
}

// Session token from the cookie or, for the Studio app, a bearer header. `cookieName` picks a tenant's own
// (the default) or the host admin's (auth.HOST_COOKIE) -- never both read from the same request's bearer header,
// since only a tenant's session is ever handed out as a bearer token. A tenant's own cookie falls back to its
// old name (LEGACY_COOKIE) when the new one is not there, so a session issued before the rename still works.
function sessionToken(req, cookieName = COOKIE) {
  const bearer = req.get('authorization') || '';
  if (cookieName === COOKIE && bearer.toLowerCase().startsWith('bearer ')) return bearer.slice(7).trim();
  const cookies = parseCookies(req.get('cookie'));
  if (cookies[cookieName]) return cookies[cookieName];
  return cookieName === COOKIE ? cookies[LEGACY_COOKIE] || null : null;
}

// --- two-step sign-in: TOTP (RFC 6238) ---------------------------------------------------------------------
// Six digits, thirty seconds, SHA-1, one step of drift either side -- the small, standard shape every
// authenticator app already speaks, needing nothing outside the server (documentation/plans/plan-mfa.md).

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_DRIFT_STEPS = 1;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  const rest = bits.length % 5;
  if (rest) out += BASE32_ALPHABET[parseInt(bits.slice(-rest).padEnd(5, '0'), 2)];
  return out;
}

function base32Decode(str) {
  let bits = '';
  for (const char of String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// A random TOTP secret: 20 bytes (160 bits, RFC 4226's own recommendation), base32 for the authenticator app
// to type in by hand if it cannot scan the QR.
function totpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotpCode(secretBuf, counter) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

function totpCode(secret, time = Date.now()) {
  return hotpCode(base32Decode(secret), Math.floor(time / 1000 / TOTP_STEP_SECONDS));
}

// The current step and one either side; a step at or before `lastStep` is refused even when the code is
// otherwise correct, so a captured code cannot be replayed a second time within its own window (the caller
// records whatever step this returns as the account's new mfa.lastStep). Returns the step used, or null when
// the code matches nothing in range.
function totpVerify(secret, code, lastStep = null) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const secretBuf = base32Decode(secret);
  const nowStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const codeBuf = Buffer.from(clean);
  for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d += 1) {
    const candidate = nowStep + d;
    if (lastStep !== null && candidate <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotpCode(secretBuf, candidate)), codeBuf)) return candidate;
  }
  return null;
}

// otpauth://totp/<issuer>:<login>?secret=...&issuer=...&algorithm=SHA1&digits=6&period=30 -- what an
// authenticator app's QR scan or manual entry both read; the issuer is the environment's own name, so
// someone with several accounts can tell them apart in their app.
function otpauthUrl(issuer, login, secret) {
  const label = encodeURIComponent(`${issuer}:${login}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- two-step sign-in: the secret's own encryption at rest, and recovery codes ------------------------------
// AES-256-GCM with a random nonce per secret (never reused), the nonce and tag stored alongside the
// ciphertext so decryption needs nothing but the key -- server/index.js resolves that key (DATA_DIR/
// secrets.key on a single server, host.json's secretsKey on a host with environments) and never lets it
// anywhere near a module.
function encryptSecret(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aesgcm$${iv.toString('hex')}$${tag.toString('hex')}$${ciphertext.toString('hex')}`;
}

function decryptSecret(stored, key) {
  if (typeof stored !== 'string' || !stored.startsWith('aesgcm$')) return null;
  const [, ivHex, tagHex, cipherHex] = stored.split('$');
  if (!ivHex || !tagHex || !cipherHex) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null; // a wrong key, or corrupt data -- either way, no secret to use
  }
}

// Ten codes, shown once, each good for one sign-in -- letters and digits only, no 0/O/1/I/l, so a person
// copying one down by hand cannot mistake the character.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomRecoveryCode() {
  let code = '';
  for (let i = 0; i < 10; i += 1) {
    if (i === 5) code += '-';
    code += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
  }
  return code;
}
function recoveryCodes(count = 10) {
  return Array.from({ length: count }, randomRecoveryCode);
}

// A handful of failed logins per address, then a cool-down.
class LoginLimiter {
  constructor(max = 10, windowMs = 15 * 60000) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  blocked(ip) {
    const entry = this.hits.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > this.windowMs) {
      this.hits.delete(ip);
      return false;
    }
    return entry.count >= this.max;
  }

  fail(ip) {
    const entry = this.hits.get(ip);
    if (!entry || Date.now() - entry.first > this.windowMs) this.hits.set(ip, { first: Date.now(), count: 1 });
    else entry.count += 1;
  }

  clear(ip) {
    this.hits.delete(ip);
  }
}

module.exports = {
  COOKIE,
  HOST_COOKIE,
  PENDING_COOKIE,
  TRUST_COOKIE,
  hashPassword,
  verifyPassword,
  issueSession,
  readSession,
  issuePending,
  readPending,
  parseCookies,
  setSessionCookie,
  setPendingCookie,
  clearSessionCookie,
  sessionToken,
  isSecure,
  totpSecret,
  totpCode,
  totpVerify,
  otpauthUrl,
  encryptSecret,
  decryptSecret,
  recoveryCodes,
  LoginLimiter,
};
