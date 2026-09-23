'use strict';

// Passwords, sessions and request authentication.
//
// Sessions are signed cookies (no server-side session table): the cookie
// carries the user key and the issue time, plus an HMAC over both. Logging
// out just clears the cookie. Deleting a user or changing their password
// invalidates their sessions because the signature covers a per-user stamp.

const crypto = require('crypto');

const COOKIE = 'tavern_session';
// The host admin's own session -- a separate cookie, never a tenant's, so the two can never be confused even on
// the same browser (the host console and an environment are different subdomains anyway; this is belt and braces).
const HOST_COOKIE = 'host_session';
const SESSION_DAYS = 30;

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

// Per-user stamp folded into the session signature, so a password change or
// a link regeneration logs the user out everywhere.
function userStamp(user) {
  return crypto.createHash('sha256').update(`${user.passwordHash || ''}|${user.linkToken || ''}`).digest('hex').slice(0, 16);
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
}

// Session token from the cookie or, for the Studio app, a bearer header. `cookieName` picks a tenant's own
// (the default) or the host admin's (auth.HOST_COOKIE) -- never both read from the same request's bearer header,
// since only a tenant's session is ever handed out as a bearer token.
function sessionToken(req, cookieName = COOKIE) {
  const bearer = req.get('authorization') || '';
  if (cookieName === COOKIE && bearer.toLowerCase().startsWith('bearer ')) return bearer.slice(7).trim();
  return parseCookies(req.get('cookie'))[cookieName] || null;
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
  hashPassword,
  verifyPassword,
  issueSession,
  readSession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  sessionToken,
  isSecure,
  LoginLimiter,
};
