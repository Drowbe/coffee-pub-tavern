// Links people saved before plan-names step 5a, answered with a permanent redirect to the same place under its new
// name (documentation/plans/plan-names.md, "The server": decision 17, the redirects stay for good). Nothing else in
// the server reads these old names; the routes below are registered before the real ones, so an old link never
// reaches them, and a request that carries no old name falls through untouched.
//
//   /rooms/<id>                            -> /spaces/<id>            a space's settings page
//   /img/room/<id>                         -> /img/space/<id>         a space's picture (Coffee Pub Studio asks this)
//   /img/<key>/<slot>?room=<id>&roomOnly=1 -> ?space=<id>&spaceOnly=1 a person's picture in a space (OBS sources)
//   /modules/<id>?moduleRoom=<id>          -> ?space=<id>             a module popped out of a space
//
// Every other part of the query is kept, in its order.
'use strict';

// The request's query with the old keys renamed (an old key whose new one is already there is dropped), as
// "?..." or "".
function renamedQuery(req, renames) {
  const at = req.originalUrl.indexOf('?');
  const given = new URLSearchParams(at === -1 ? '' : req.originalUrl.slice(at + 1));
  const out = new URLSearchParams();
  for (const [key, value] of given) {
    const to = renames[key];
    if (to && given.has(to)) continue;
    out.append(to || key, value);
  }
  const text = out.toString();
  return text ? `?${text}` : '';
}

const hasAny = (req, keys) => keys.some((k) => Object.prototype.hasOwnProperty.call(req.query, k));

function mountOldLinks(app) {
  app.get('/rooms/:id', (req, res) => {
    res.redirect(301, `/spaces/${encodeURIComponent(req.params.id)}${renamedQuery(req, {})}`);
  });
  app.get('/img/room/:id', (req, res) => {
    res.redirect(301, `/img/space/${encodeURIComponent(req.params.id)}${renamedQuery(req, {})}`);
  });
  const IMAGE_QUERY = { room: 'space', roomOnly: 'spaceOnly' };
  app.get('/img/:key/:slot', (req, res, next) => {
    if (!hasAny(req, Object.keys(IMAGE_QUERY))) return next();
    res.redirect(301, `/img/${encodeURIComponent(req.params.key)}/${encodeURIComponent(req.params.slot)}${renamedQuery(req, IMAGE_QUERY)}`);
  });
  const POPOUT_QUERY = { moduleRoom: 'space' };
  app.get('/modules/:id', (req, res, next) => {
    if (!hasAny(req, Object.keys(POPOUT_QUERY))) return next();
    res.redirect(301, `/modules/${encodeURIComponent(req.params.id)}${renamedQuery(req, POPOUT_QUERY)}`);
  });
}

module.exports = { mountOldLinks, renamedQuery };
