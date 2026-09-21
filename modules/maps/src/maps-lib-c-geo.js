  // What Maps needs beyond the SDK's `tavern.util.geo` (defined by the page ahead of this code): a search endpoint's results,
  // pins that would overlap, and the bounds of some points. No page in it, so the checks can run it.

  // The results of a Photon-compatible search (GeoJSON features), as { title, sub, lat, lng }.
  function searchResults(json, max) {
    const feats = json && Array.isArray(json.features) ? json.features : [];
    const out = [];
    for (const f of feats) {
      const c = f && f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
      const pr = (f && f.properties) || {};
      if (!c) continue;
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (!geo.inRange(lat, lng)) continue;
      const street = [pr.street, pr.housenumber].filter(Boolean).join(' ');
      const title = geo.oneLine(pr.name || street || pr.city || pr.country || '', 120);
      if (!title) continue;
      const sub = geo.oneLine([street && street !== title ? street : '', pr.district, pr.city && pr.city !== title ? pr.city : '', pr.state, pr.country].filter(Boolean).join(', '), 160);
      out.push({ title, sub, lat: geo.round6(lat), lng: geo.round6(lng) });
      if (out.length >= (max || 6)) break;
    }
    return out;
  }

  // Group points that would overlap on screen. `project(lat, lng)` gives { x, y } in pixels; a point joins the first
  // group whose first point is within `radius` pixels. Returns [{ points, lat, lng }] (the centre of a group is the mean).
  function clusterPoints(points, project, radius) {
    const groups = [];
    for (const p of points) {
      const s = project(p.lat, p.lng);
      let g = groups.find((x) => Math.hypot(x.x - s.x, x.y - s.y) <= radius);
      if (!g) {
        g = { x: s.x, y: s.y, points: [], lat: 0, lng: 0 };
        groups.push(g);
      }
      g.points.push(p);
    }
    for (const g of groups) {
      g.lat = g.points.reduce((a, p) => a + p.lat, 0) / g.points.length;
      g.lng = g.points.reduce((a, p) => a + p.lng, 0) / g.points.length;
    }
    return groups;
  }

  // The bounds of some points: [[west, south], [east, north]] or null.
  function boundsOf(points) {
    if (!points.length) return null;
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of points) { w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
    return [[w, s], [e, n]];
  }
