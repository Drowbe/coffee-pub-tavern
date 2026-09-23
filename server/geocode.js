// A module's place search, asked from the server: local first (the places this server has already seen), the outside service
// (a Photon-compatible address the admin chose) only when the server has too few, and, if the admin allows it, everything the
// service returns is kept, so the server builds its own place data from use and asks less and less.
//
// What is kept is a fact about a place: the OpenStreetMap type and id, the name, the address, the position, the category, when it
// was first and last seen, how many times it was returned, and whether anyone picked it (`used`). Never what was searched for, who
// searched, or from which room. The collection belongs to the server and is shared by every room.
//
// Files: DATA_DIR/modules/<module id>/geocode.json (a module that declares `geocoder` in its manifest). Kept in memory, written
// a moment after a change.
'use strict';

const fs = require('fs');
const path = require('path');

const ENOUGH = 5; // this many saved results answer a search without asking outside
const MAX_PLACES = 100000;
const FETCH_MS = 6000;
const MAX_BODY = 400 * 1024;

const oneLine = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// The places in a Photon-compatible answer (GeoJSON features), as records to keep.
function parsePhoton(json, max = 10) {
  const feats = json && Array.isArray(json.features) ? json.features : [];
  const out = [];
  for (const f of feats) {
    const c = f && f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
    const pr = (f && f.properties) || {};
    if (!c) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!inRange(lat, lng)) continue;
    const street = [pr.street, pr.housenumber].filter(Boolean).join(' ');
    const name = oneLine(pr.name || street || pr.city || pr.country || '', 120);
    if (!name) continue;
    const address = oneLine([street && street !== name ? street : '', pr.district, pr.city && pr.city !== name ? pr.city : '', pr.state, pr.country].filter(Boolean).join(', '), 160);
    const type = ['N', 'W', 'R'].includes(pr.osm_type) ? pr.osm_type : '';
    const id = Number.isFinite(Number(pr.osm_id)) ? Number(pr.osm_id) : 0;
    // A place's rough rectangle (a country, a city...), when the service gives one: not part of a saved place (the geocode
    // cache never keeps it, since it only ever stores a point), only read live for "find a place to cut a map region for".
    const ext = Array.isArray(pr.extent) && pr.extent.length === 4 && pr.extent.every((n) => Number.isFinite(n))
      ? { minLon: round6(Math.min(pr.extent[0], pr.extent[2])), minLat: round6(Math.min(pr.extent[1], pr.extent[3])), maxLon: round6(Math.max(pr.extent[0], pr.extent[2])), maxLat: round6(Math.max(pr.extent[1], pr.extent[3])) }
      : null;
    out.push({ osmType: type, osmId: type ? id : 0, name, address, lat: round6(lat), lng: round6(lng), category: oneLine([pr.osm_key, pr.osm_value].filter(Boolean).join(':'), 40), ...(ext ? { extent: ext } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

// The key of a place: its OpenStreetMap type and id, or, without them, its name and position.
const keyOf = (p) => (p.osmType && p.osmId ? `${p.osmType}${p.osmId}` : `p:${p.lat.toFixed(5)},${p.lng.toFixed(5)}:${fold(p.name).slice(0, 40)}`);

class GeocodeCache {
  constructor(modulesDir) {
    this.dir = modulesDir;
    this.data = new Map(); // module id -> Map(key -> record)
    this.timers = new Map();
  }

  file(id) {
    return path.join(this.dir, id, 'geocode.json');
  }

  places(id) {
    let m = this.data.get(id);
    if (m) return m;
    m = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
      for (const r of Array.isArray(raw.places) ? raw.places : []) if (r && typeof r.key === 'string' && inRange(r.lat, r.lng)) m.set(r.key, r);
    } catch {
      // nothing saved yet
    }
    this.data.set(id, m);
    return m;
  }

  save(id) {
    if (this.timers.has(id)) return;
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); this.flushOne(id); }, 2000));
  }

  flushOne(id) {
    const m = this.data.get(id);
    if (!m) return;
    try {
      fs.mkdirSync(path.dirname(this.file(id)), { recursive: true });
      const tmp = `${this.file(id)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ places: [...m.values()] }));
      fs.renameSync(tmp, this.file(id));
    } catch (err) {
      console.error('could not save the place collection:', err.message);
    }
  }

  flush() {
    for (const [id, t] of this.timers) { clearTimeout(t); this.flushOne(id); }
    this.timers.clear();
  }

  // Keep what a search returned. Returns the records (with their keys), whether or not they were new.
  remember(id, found) {
    const m = this.places(id);
    const now = new Date().toISOString();
    const out = [];
    for (const p of found) {
      const key = keyOf(p);
      const old = m.get(key);
      const rec = old ? { ...old, name: p.name, address: p.address, lat: p.lat, lng: p.lng, category: p.category || old.category, lastSeen: now, seen: (old.seen || 1) + 1 } : { key, osmType: p.osmType, osmId: p.osmId, name: p.name, address: p.address, lat: p.lat, lng: p.lng, category: p.category, firstSeen: now, lastSeen: now, seen: 1, used: false };
      m.set(key, rec);
      out.push(rec);
    }
    // A cap, so it cannot grow for ever: the oldest unused places go first.
    if (m.size > MAX_PLACES) {
      const drop = [...m.values()].filter((r) => !r.used).sort((a, b) => String(a.lastSeen).localeCompare(String(b.lastSeen))).slice(0, m.size - MAX_PLACES);
      for (const r of drop) m.delete(r.key);
    }
    this.save(id);
    return out;
  }

  // Saved places matching what was typed: every word must be in the name or the address, best matches (a name that starts with it)
  // first, nearer ones ahead of farther when a position is given.
  search(id, q, near, limit = 10) {
    const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    const scored = [];
    for (const r of this.places(id).values()) {
      const name = fold(r.name);
      const hay = `${name} ${fold(r.address)}`;
      if (!words.every((w) => hay.includes(w))) continue;
      let score = name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2;
      if (r.used) score -= 0.5;
      const dist = near && inRange(near.lat, near.lon) ? Math.hypot(r.lat - near.lat, (r.lng - near.lon) * Math.cos((near.lat * Math.PI) / 180)) : 0;
      scored.push({ r, score, dist });
    }
    scored.sort((a, b) => a.score - b.score || a.dist - b.dist || b.r.seen - a.r.seen);
    return scored.slice(0, limit).map((x) => x.r);
  }

  markUsed(id, key) {
    const r = this.places(id).get(String(key));
    if (!r) return false;
    if (!r.used) { r.used = true; this.save(id); }
    return true;
  }

  stats(id) {
    const all = [...this.places(id).values()];
    return { saved: all.length, used: all.filter((r) => r.used).length, oldest: all.reduce((a, r) => (!a || r.firstSeen < a ? r.firstSeen : a), null) };
  }

  // Remove places by their mark: `unused` (optionally only those last seen more than `olderThanDays` days ago; used ones are always
  // kept) or `all`. Returns how many went.
  purge(id, what, olderThanDays) {
    const m = this.places(id);
    const before = m.size;
    const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * 86400000 : null;
    for (const r of [...m.values()]) {
      if (what === 'all') m.delete(r.key);
      else if (what === 'unused' && !r.used && (cutoff === null || new Date(r.lastSeen).getTime() < cutoff)) m.delete(r.key);
    }
    this.save(id);
    return before - m.size;
  }
}

// Ask a Photon-compatible service (address given by the admin), with a limit on time and size.
async function askService(address, q, near) {
  const u = new URL(address);
  if (!/^https?:$/.test(u.protocol)) throw new Error('search address must be http or https');
  u.searchParams.set('q', String(q).slice(0, 200));
  u.searchParams.set('limit', '10');
  if (near && inRange(Number(near.lat), Number(near.lon))) { u.searchParams.set('lat', String(round6(Number(near.lat)))); u.searchParams.set('lon', String(round6(Number(near.lon)))); }
  const res = await fetch(u.href, { headers: { Accept: 'application/json', 'User-Agent': 'CoffeePubApp' }, signal: AbortSignal.timeout(FETCH_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`search answered ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BODY) throw new Error('search answered too much');
  return parsePhoton(JSON.parse(text));
}

module.exports = { GeocodeCache, parsePhoton, keyOf, askService, ENOUGH };
