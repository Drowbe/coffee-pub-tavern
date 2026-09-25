// Call names (documentation/plans/plan-names.md, decision 14). Each space has its own call at the call service,
// named by nothing stored: a space's call is its id (the Lobby's is `lobby`) and an aside's is `aside-<id>`. On a
// hosted server (BASE_DOMAIN set), where the environments share one LiveKit, each is prefixed with the environment's
// slug and a dot: `<slug>.<id>`, `<slug>.aside-<id>`. No slug (host-registry's SLUG_RE: letters, digits and hyphens)
// and no space or aside id (Store.sanitizeRoom: 4 to 16 lower-case letters and digits) can hold a dot, so the dot
// says exactly where the slug ends, and one environment's call can never read as another's.
//
// Before plan-names step 3 a call was named from the stored setting settings.room ('table'): the Lobby's was the
// base itself and every other space's (asides too) was `<base>-<id>`, prefixed `<slug>-` when hosted. For one
// release those shapes are still read back (previousSpaceIdOfCall), so people already in a call when the server
// upgrades are still found and placed; callName hands out only the new ones. The old shapes go after that release
// (step 10 at the latest).
'use strict';

const LOBBY = 'lobby';
const ASIDE_PREFIX = 'aside-';
const SEPARATOR = '.';
const PREVIOUS_CALL_BASE = 'table';

// The call for a space or an aside. `slug` is the environment's (null on a single-environment install); `aside`
// whether the id is an aside's.
function callName({ slug = null, spaceId = LOBBY, aside = false } = {}) {
  const own = `${aside ? ASIDE_PREFIX : ''}${spaceId || LOBBY}`;
  return slug ? `${slug}${SEPARATOR}${own}` : own;
}

// The space (or aside) id a call belongs to, or null when the call is not one of this environment's own.
// `hasSpace(id)` says whether this environment has that space or aside; `slugs()` lists every environment's slug on
// this host (only the old hosted shapes need it). An id this environment really has is preferred over reading the
// name as an old shape, so a space whose id is exactly `table` is that space, not the Lobby.
function spaceIdOfCall(name, { slug = null, hasSpace = () => true, slugs = () => [] } = {}) {
  if (typeof name !== 'string' || !name) return null;
  let own = null;
  if (slug) own = name.startsWith(`${slug}${SEPARATOR}`) ? name.slice(slug.length + 1) : null;
  else own = name.includes(SEPARATOR) ? null : name;
  if (own !== null && !own.includes(SEPARATOR)) {
    if (hasSpace(own)) return own;
    if (own.startsWith(ASIDE_PREFIX)) {
      const id = own.slice(ASIDE_PREFIX.length);
      if (id && hasSpace(id)) return id;
    }
  }
  return previousSpaceIdOfCall(name, { slug, hasSpace, slugs });
}

// The old shapes only (one release): `table` and `table-<id>` on a single install, `<slug>-table` and
// `<slug>-table-<id>` hosted. Never a dotted name (every new hosted name has a dot), never `table-lobby` (the Lobby's
// call was always the base itself), only an id this environment has, and never when another environment's slug is
// a longer match for the name (`acme-table-table` is environment acme-table's old Lobby, not a space of acme's).
function previousSpaceIdOfCall(name, { slug, hasSpace, slugs }) {
  if (name.includes(SEPARATOR)) return null;
  const matches = (s) => name === `${s}-${PREVIOUS_CALL_BASE}` || name.startsWith(`${s}-${PREVIOUS_CALL_BASE}-`);
  let rest = name;
  if (slug) {
    if (!matches(slug)) return null;
    if ((slugs() || []).some((s) => s !== slug && s.length > slug.length && matches(s))) return null;
    rest = name.slice(slug.length + 1);
  }
  if (rest === PREVIOUS_CALL_BASE) return hasSpace(LOBBY) ? LOBBY : null;
  if (!rest.startsWith(`${PREVIOUS_CALL_BASE}-`)) return null;
  const id = rest.slice(PREVIOUS_CALL_BASE.length + 1);
  return id && id !== LOBBY && hasSpace(id) ? id : null;
}

module.exports = { callName, spaceIdOfCall, SEPARATOR };
