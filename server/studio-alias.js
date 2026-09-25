// The Studio alias (documentation/plans/plan-names.md, "The Studio alias" and "What Studio reads"): while Coffee
// Pub Studio still reads the old names, the answers to its own requests carry them beside the new ones. Studio
// signs in with a bearer token (server/auth.js, sessionToken); the pages use the cookie, so only a bearer request
// is ever given an old name and the pages never see one (decision 21).
//
// This is the one place old names are added back. Each step of the plan that renames something Studio reads adds
// one entry to ME or STATUS below, in that same step, and nothing else: an entry is (answer, context) -> the
// extra fields to send, by their old names. Step 10 removes this file when a Studio release reads the new names.
//
//   step 3:  tableName (both answers), set to the environment's name
//   step 4:  user.role 'admin' for an owner (/api/me); users[].role 'admin' / 'user' (/api/status)
//   step 5a: serverName (both); rooms, activeRoom, users[].online.room (/api/status)
//   step 8:  aside rows in rooms with ephemeral: true (/api/status)
'use strict';

// Step 3: tableName ("The Table", a stored setting until then) is gone; Studio still reads it (kept, not shown), so
// it gets the environment's name under that old name.
const tableName = (_answer, { environmentName }) => ({ tableName: environmentName });

// GET /api/me. Context: { role, hostAdmin, environmentName } -- the few values an entry needs, never the account
// record itself (it holds the password hash and the two-step secret).
const ME = [tableName];
// GET /api/status. Context: { environmentName }; the rest is in the answer.
const STATUS = [tableName];

// Whether this request signed in the way Studio does: by a bearer token that actually signed someone in, rather
// than the pages' cookie. A bearer header is read before any cookie (auth.sessionToken), so a request carrying one
// has a signed-in person only when that token was good; a request let in some other way (the stream key, say) with
// a bearer header that signs nobody in is not Studio's and gets no old names.
function fromStudio(req, signedIn) {
  return Boolean(signedIn) && String(req.get('authorization') || '').toLowerCase().startsWith('bearer ');
}

// The answer as it is for everyone else, or, for Studio's request with entries to apply, the answer with the old
// names added. With no entries it is the very same object, so the answer is exactly what it was.
function apply(entries, req, answer, context = {}) {
  const { signedIn, ...given } = context;
  if (!entries.length || !fromStudio(req, signedIn)) return answer;
  let out = answer;
  for (const entry of entries) out = { ...out, ...entry(out, given) };
  return out;
}

const me = (req, answer, context) => apply(ME, req, answer, context);
const status = (req, answer, context) => apply(STATUS, req, answer, context);

module.exports = { me, status, fromStudio, ME, STATUS };
