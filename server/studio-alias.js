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

// Step 4: the roles. Studio refuses anyone whose role is not 'admin' and looks for an online 'admin' to know the
// game's runner is there, so it is sent the old values: 'admin' for an owner (and for the host admin's stand-in,
// which is 'admin' already), 'user' for a member. The field keeps its name, so the old value replaces the new one
// in Studio's answer only. streamKey needs nothing here: the server sends it to an owner already.
const OLD_ROLE = { owner: 'admin', admin: 'admin', member: 'user' };
const oldRole = (role) => OLD_ROLE[role] || role;
const meRole = (answer) => (answer.user ? { user: { ...answer.user, role: oldRole(answer.user.role) } } : {});
const statusRoles = (answer) => (Array.isArray(answer.users) ? { users: answer.users.map((u) => ({ ...u, role: oldRole(u.role) })) } : {});

// Step 5a: a space is no longer a room and the environment's name is no longer the server's. Studio still reads
// serverName (both answers), and from /api/status the spaces as `rooms` (every row exactly as `spaces` has them; the
// asides are added after them by step 8's entry), the space the stream hears as `activeRoom`, and where each person is online as
// users[].online.room (micOn and cameraOn are unchanged).
const serverName = (_answer, { environmentName }) => ({ serverName: environmentName });
const statusSpaces = (answer) => ({
  ...(Array.isArray(answer.spaces) ? { rooms: answer.spaces } : {}),
  ...('activeSpace' in answer ? { activeRoom: answer.activeSpace } : {}),
  ...(Array.isArray(answer.users) ? { users: answer.users.map((u) => (u && u.online && typeof u.online === 'object' ? { ...u, online: { ...u.online, room: u.online.space } } : u)) } : {}),
});

// Step 8: an aside is no longer a row among the spaces but its own record (`asides`). Studio still finds asides as
// rows in `rooms` marked `ephemeral: true` (to dim someone aside and hide someone in a private conversation), so each
// aside is sent there after the spaces, in the shape such a row had: its id, members, origin, private and createdAt,
// named with the environment's word for an aside ("Aside" unless a template renames it), with a space's other
// fields at the values an aside row always had. Only `rooms` carries them; `spaces` and `asides` are as they are.
const asideRow = (aside, asideName) => ({
  id: aside.id, name: asideName || 'Aside', description: '', members: aside.members, createdAt: aside.createdAt,
  ephemeral: true, origin: aside.origin ?? null, private: Boolean(aside.private),
  profile: 'roleplaying', link: null, linkIcon: 'link', guestToken: null, allowGuests: true, isLobby: false, hasImage: false,
});
// The spaces' own rows in `rooms` keep the aside fields at the values every space had (ephemeral and private false,
// origin null), so a row read the way Studio reads it says the same as before.
const spaceRow = (space) => ({ ...space, ephemeral: false, origin: null, private: false });
const statusAsides = (answer, { asideName }) => (Array.isArray(answer.rooms) && Array.isArray(answer.asides)
  ? { rooms: [...answer.rooms.map(spaceRow), ...answer.asides.map((a) => asideRow(a, asideName))] }
  : {});

// GET /api/me. Context: { role, hostAdmin, environmentName } -- the few values an entry needs, never the account
// record itself (it holds the password hash and the two-step secret).
const ME = [tableName, meRole, serverName];
// GET /api/status. Context: { environmentName, asideName }; the rest is in the answer. statusAsides reads the
// `rooms` statusSpaces made, so it comes after it.
const STATUS = [tableName, statusRoles, serverName, statusSpaces, statusAsides];

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

module.exports = { me, status, fromStudio, oldRole, ME, STATUS };
