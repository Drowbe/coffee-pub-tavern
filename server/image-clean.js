// What Tavern does to a photo a person uploads, without decoding it: find out what it is (from its own bytes, never from what the
// sender says), read the few facts it carries (when it was taken, the camera, where), and take out everything else that rides along
// (text chunks, thumbnails, maker notes, editing history, the position unless the person keeps it). The picture's own data is
// untouched, so this is fast, adds no dependency and cannot make a picture worse. Resizing and a thumbnail are made by the page
// before it sends (see the SDK guide); this is the server's check on what arrives.
//
// JPEG: every segment is dropped except the ones that draw the picture, and the orientation is kept as a tiny EXIF of its own so a
// phone photo does not turn on its side. PNG: only the chunks that draw the picture. WebP: only the chunks that draw the picture.
'use strict';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// What the bytes are: 'image/jpeg', 'image/png', 'image/webp' or null.
function sniff(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 20 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// --- EXIF (a TIFF block) ---------------------------------------------------------------------------------------------------
function readTiff(t) {
  if (t.length < 8) return {};
  const le = t.toString('latin1', 0, 2) === 'II';
  if (!le && t.toString('latin1', 0, 2) !== 'MM') return {};
  const u16 = (o) => (o + 2 <= t.length ? (le ? t.readUInt16LE(o) : t.readUInt16BE(o)) : 0);
  const u32 = (o) => (o + 4 <= t.length ? (le ? t.readUInt32LE(o) : t.readUInt32BE(o)) : 0);
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const entries = (ifd) => {
    const out = new Map();
    if (!ifd || ifd + 2 > t.length) return out;
    const n = Math.min(u16(ifd), 200);
    for (let i = 0; i < n; i += 1) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > t.length) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const bytes = (sizes[type] || 1) * count;
      out.set(u16(e), { type, count, at: bytes <= 4 ? e + 8 : u32(e + 8), bytes });
    }
    return out;
  };
  const ascii = (en) => (en && en.at + en.bytes <= t.length ? t.toString('latin1', en.at, en.at + Math.max(0, en.bytes - 1)).replace(/\0.*$/, '').trim() : '');
  const rational = (at) => { const d = u32(at + 4); return d ? u32(at) / d : 0; };
  const dms = (en) => (en && en.count === 3 && en.at + 24 <= t.length ? rational(en.at) + rational(en.at + 8) / 60 + rational(en.at + 16) / 3600 : null);
  const ifd0 = entries(u32(4));
  const out = {};
  const orient = ifd0.get(0x0112);
  if (orient) out.orientation = u16(orient.at) || 1;
  const make = ascii(ifd0.get(0x010f));
  const model = ascii(ifd0.get(0x0110));
  if (make || model) out.camera = (model.startsWith(make) ? model : `${make} ${model}`).trim().slice(0, 60);
  const sub = ifd0.get(0x8769);
  if (sub) {
    const ex = entries(u32(sub.at));
    const taken = ascii(ex.get(0x9003) || ex.get(0x9004));
    const m = /^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(taken);
    if (m && +m[1] > 1970) out.taken = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`; // the camera's own clock, no zone
  }
  const gpsAt = ifd0.get(0x8825);
  if (gpsAt) {
    const g = entries(u32(gpsAt.at));
    let lat = dms(g.get(2));
    let lng = dms(g.get(4));
    if (lat !== null && lng !== null) {
      if (ascii(g.get(1)).toUpperCase() === 'S') lat = -lat;
      if (ascii(g.get(3)).toUpperCase() === 'W') lng = -lng;
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) out.position = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    }
  }
  return out;
}

// An EXIF block holding only the orientation (big-endian): what is left of a photo's EXIF once the rest is taken out.
function orientationExif(o) {
  const t = Buffer.alloc(8 + 2 + 12 + 4);
  t.write('MM', 0, 'latin1');
  t.writeUInt16BE(42, 2);
  t.writeUInt32BE(8, 4);
  t.writeUInt16BE(1, 8); // one entry
  t.writeUInt16BE(0x0112, 10);
  t.writeUInt16BE(3, 12); // SHORT
  t.writeUInt32BE(1, 14);
  t.writeUInt16BE(o, 18);
  const head = Buffer.from('Exif\0\0', 'latin1');
  const body = Buffer.concat([head, t]);
  const seg = Buffer.alloc(4);
  seg[0] = 0xff; seg[1] = 0xe1;
  seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([seg, body]);
}

// --- JPEG ------------------------------------------------------------------------------------------------------------------
function cleanJpeg(b, keepPosition) {
  const out = [b.subarray(0, 2)];
  const facts = {};
  let i = 2;
  let wroteOrientation = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('this is not a whole JPEG picture');
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new Error('this is not a whole JPEG picture');
    const seg = b.subarray(i, i + 2 + len);
    if (marker === 0xda) { out.push(b.subarray(i)); i = b.length; break; } // the picture itself: everything to the end
    if (marker === 0xe1 && seg.toString('latin1', 4, 10) === 'Exif\0\0') {
      const info = readTiff(seg.subarray(10));
      Object.assign(facts, info);
      if (keepPosition) { out.push(seg); wroteOrientation = true; } // the person chose to keep the whole EXIF
      else if (info.orientation && info.orientation > 1 && !wroteOrientation) { out.push(orientationExif(info.orientation)); wroteOrientation = true; }
    } else if (marker === 0xe0 || (marker >= 0xc0 && marker <= 0xcf) || marker === 0xdb || marker === 0xc4 || marker === 0xdd || marker === 0xee) {
      out.push(seg); // JFIF, the frame, the tables, the restart interval, Adobe's colour flag
    } // everything else (other application data, comments, ICC profiles, XMP) is not kept
    i += 2 + len;
  }
  if (!out.some((p) => p[1] === 0xda)) throw new Error('this is not a whole JPEG picture');
  return { bytes: Buffer.concat(out), facts };
}

// --- PNG -------------------------------------------------------------------------------------------------------------------
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'acTL', 'fcTL', 'fdAT']);
function cleanPng(b) {
  const out = [b.subarray(0, 8)];
  let i = 8;
  let ended = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    if (len > b.length || i + 12 + len > b.length) throw new Error('this is not a whole PNG picture');
    if (PNG_KEEP.has(type)) out.push(b.subarray(i, i + 12 + len));
    i += 12 + len;
    if (type === 'IEND') { ended = true; break; }
  }
  if (!ended) throw new Error('this is not a whole PNG picture');
  return { bytes: Buffer.concat(out), facts: {} };
}

// --- WebP ------------------------------------------------------------------------------------------------------------------
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']);
function cleanWebp(b, keepPosition) {
  const size = b.readUInt32LE(4) + 8;
  if (size > b.length + 1) throw new Error('this is not a whole WebP picture');
  const parts = [];
  const facts = {};
  let i = 12;
  while (i + 8 <= Math.min(size, b.length)) {
    const type = b.toString('latin1', i, i + 4);
    const len = b.readUInt32LE(i + 4);
    const total = 8 + len + (len % 2);
    if (i + 8 + len > b.length) throw new Error('this is not a whole WebP picture');
    let chunk = b.subarray(i, Math.min(i + total, b.length));
    if (type === 'EXIF') {
      const t = b.subarray(i + 8, i + 8 + len);
      Object.assign(facts, readTiff(t.toString('latin1', 0, 6) === 'Exif\0\0' ? t.subarray(6) : t));
      if (keepPosition) parts.push(chunk);
    } else if (WEBP_KEEP.has(type)) {
      if (type === 'VP8X') { chunk = Buffer.from(chunk); chunk[8] &= keepPosition ? 0xdb : 0xd3; } // clear the flags for ICC (0x20) and XMP (0x04), and EXIF (0x08) unless it is kept
      parts.push(chunk);
    }
    i += total;
  }
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return { bytes: Buffer.concat([head, body]), facts };
}

// The cleaned picture and what it carried: { type, bytes, taken, camera, hasPosition, position }. `position` is set only when the
// person chose to keep it; `hasPosition` says the photo had one (so the person can be offered the choice). Throws an Error with a
// plain message for anything that is not a whole picture of an allowed type.
function cleanImage(buf, allowed, keepPosition) {
  const type = sniff(buf);
  if (!type || !allowed.includes(type)) throw new Error('that kind of file is not accepted here');
  const done = type === 'image/jpeg' ? cleanJpeg(buf, keepPosition) : type === 'image/png' ? cleanPng(buf) : cleanWebp(buf, keepPosition);
  const f = done.facts;
  return { type, bytes: done.bytes, taken: f.taken || null, camera: f.camera || '', hasPosition: !!f.position, position: keepPosition && f.position ? f.position : null };
}

module.exports = { cleanImage, sniff, readTiff, TYPES };
