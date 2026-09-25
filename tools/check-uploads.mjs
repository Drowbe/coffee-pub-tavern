#!/usr/bin/env node
/*
 * check-uploads.mjs -- run what the server does to an uploaded picture (server/image-clean.js) and the store for uploaded files
 * (server/module-uploads.js) on their own, with pictures built by hand: the position and hidden data go, the orientation stays,
 * a file that is not a picture is refused, and limits and removal hold.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cleanImage, inspectHead, readTiff } = require('../server/image-clean.js');
const { ModuleUploads } = require('../server/module-uploads.js');
let n = 0;
const test = (name, fn) => { fn(); n += 1; };

// An EXIF block (big-endian) with a camera, a time, an orientation and a position: 52.5N 13.4E.
function exifTiff() {
  const parts = [];
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
  const ent = (tag, type, count, value) => Buffer.concat([u16(tag), u16(type), u32(count), value]);
  // layout: header 8, IFD0 (4 entries) at 8, data after
  const ifd0At = 8;
  const ifd0Len = 2 + 4 * 12 + 4;
  const exifAt = ifd0At + ifd0Len;
  const exifLen = 2 + 12 + 4;
  const gpsAt = exifAt + exifLen;
  const gpsLen = 2 + 4 * 12 + 4;
  const dataAt = gpsAt + gpsLen;
  const make = Buffer.from('Acme\0');
  const dt = Buffer.from('2026:09:21 14:30:05\0');
  const rat = (a, b) => Buffer.concat([u32(a), u32(b)]);
  const latData = Buffer.concat([rat(52, 1), rat(30, 1), rat(0, 1)]);
  const lngData = Buffer.concat([rat(13, 1), rat(24, 1), rat(0, 1)]);
  const makeAt = dataAt;
  const dtAt = makeAt + make.length;
  const latAt = dtAt + dt.length;
  const lngAt = latAt + 24;
  const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - b.length)]);
  parts.push(Buffer.from('MM'), u16(42), u32(ifd0At));
  parts.push(u16(4), ent(0x010f, 2, make.length, u32(makeAt)), ent(0x0112, 3, 1, Buffer.concat([u16(6), u16(0)])), ent(0x8769, 4, 1, u32(exifAt)), ent(0x8825, 4, 1, u32(gpsAt)), u32(0));
  parts.push(u16(1), ent(0x9003, 2, dt.length, u32(dtAt)), u32(0));
  parts.push(u16(4), ent(1, 2, 2, pad(Buffer.from('N\0'))), ent(2, 5, 3, u32(latAt)), ent(3, 2, 2, pad(Buffer.from('E\0'))), ent(4, 5, 3, u32(lngAt)), u32(0));
  parts.push(make, dt, latData, lngData);
  return Buffer.concat(parts);
}
const seg = (marker, body) => { const h = Buffer.alloc(4); h[0] = 0xff; h[1] = marker; h.writeUInt16BE(body.length + 2, 2); return Buffer.concat([h, body]); };
const jpeg = ({ exif = true, extra = true } = {}) => Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
  ...(exif ? [seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), exifTiff()]))] : []),
  ...(extra ? [seg(0xfe, Buffer.from('secret comment')), seg(0xed, Buffer.from('Photoshop 3.0\0hidden')), seg(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<xmp/>'))] : []),
  seg(0xdb, Buffer.alloc(65, 1)),
  seg(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.from([0x12, 0x34, 0xff, 0xd9]),
]);
const png = () => {
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); return b; };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13, 1)), chunk('tEXt', Buffer.from('Comment\0hidden')), chunk('eXIf', Buffer.from('MM')), chunk('IDAT', Buffer.from([1, 2, 3])), chunk('IEND', Buffer.alloc(0))]);
};
const webp = () => {
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + (d.length % 2)); b.write(t, 0, 'latin1'); b.writeUInt32LE(d.length, 4); d.copy(b, 8); return b; };
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x2c; // ICC, EXIF, XMP flags set
  const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', vp8x), chunk('VP8 ', Buffer.alloc(10, 7)), chunk('EXIF', Buffer.from('Exif\0\0MM')), chunk('XMP ', Buffer.from('<x/>'))]);
  const head = Buffer.alloc(8); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};
const ALL = ['image/jpeg', 'image/png', 'image/webp'];

test('EXIF facts are read', () => {
  const f = readTiff(exifTiff());
  assert.equal(f.camera, 'Acme');
  assert.equal(f.taken, '2026-09-21T14:30:05');
  assert.equal(f.orientation, 6);
  assert.deepEqual(f.position, { lat: 52.5, lng: 13.4 });
});

test('a JPEG loses its position and hidden data, and keeps its orientation', () => {
  const r = cleanImage(jpeg(), ALL, false);
  assert.equal(r.type, 'image/jpeg');
  assert.equal(r.hasPosition, true);
  assert.equal(r.position, null);
  assert.equal(r.taken, '2026-09-21T14:30:05');
  assert.equal(r.camera, 'Acme');
  const text = r.bytes.toString('latin1');
  for (const gone of ['secret comment', 'Photoshop', 'xmp', 'Acme', '2026:09']) assert.ok(!text.includes(gone), gone);
  const again = cleanImage(r.bytes, ALL, false);
  assert.equal(again.hasPosition, false);
  assert.equal(readTiff(r.bytes.subarray(r.bytes.indexOf(Buffer.from('MM')))).orientation, 6);
  assert.ok(r.bytes.subarray(-4).equals(Buffer.from([0x12, 0x34, 0xff, 0xd9])));
});

test('the start of a picture says what it carries', () => {
  const i = inspectHead(jpeg().subarray(0, 300));
  assert.deepEqual({ ...i }, { type: 'image/jpeg', taken: '2026-09-21T14:30:05', camera: 'Acme', hasPosition: true, position: { lat: 52.5, lng: 13.4 } });
  assert.equal(inspectHead(jpeg({ exif: false })).hasPosition, false);
  assert.equal(inspectHead(Buffer.from('nope nope nope')).type, null);
  assert.equal(inspectHead(png()).hasPosition, false);
});

test('a JPEG keeps its position only when the person chose to', () => {
  const r = cleanImage(jpeg(), ALL, true);
  assert.deepEqual(r.position, { lat: 52.5, lng: 13.4 });
  assert.equal(cleanImage(r.bytes, ALL, true).hasPosition, true);
  assert.ok(!r.bytes.toString('latin1').includes('secret comment'));
});

test('a PNG and a WebP lose what rides along', () => {
  const p = cleanImage(png(), ALL, false);
  assert.equal(p.type, 'image/png');
  assert.ok(!p.bytes.toString('latin1').includes('hidden') && !p.bytes.includes(Buffer.from('eXIf')));
  const w = cleanImage(webp(), ALL, false);
  assert.equal(w.type, 'image/webp');
  const wt = w.bytes.toString('latin1');
  assert.ok(!wt.includes('EXIF') && !wt.includes('XMP '));
  assert.equal(w.bytes.readUInt32LE(4), w.bytes.length - 8);
  assert.equal(w.bytes[20] & 0x2c, 0); // the flags for ICC, EXIF and XMP are cleared
});

test('what is not a whole picture of an allowed type is refused', () => {
  assert.throws(() => cleanImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), ALL, false), /not accepted/);
  assert.throws(() => cleanImage(Buffer.from('GIF89a' + 'x'.repeat(40)), ALL, false), /not accepted/);
  assert.throws(() => cleanImage(png(), ['image/jpeg'], false), /not accepted/);
  assert.throws(() => cleanImage(jpeg().subarray(0, 40), ALL, false), /whole/);
  assert.throws(() => cleanImage(png().subarray(0, 60), ALL, false), /whole/);
});

test('the store: per scope, limits, thumbnails and removal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
  const u = new ModuleUploads(dir);
  const rule = { types: ALL, maxBytes: 5000, maxFiles: 2 };
  const a = u.put('research', 'space:abcd1234', rule, { bytes: jpeg(), name: 'a\n.jpg', by: 'u1', keepPosition: false });
  assert.equal(a.name, 'a .jpg');
  assert.equal(a.position, null);
  assert.equal(a.hasPosition, true);
  assert.equal(u.list('research', 'space:abcd1234').length, 1);
  assert.equal(u.list('research', 'space:other123').length, 0);
  assert.equal(u.list('research', 'person:u1u1u1').length, 0);
  assert.equal(u.read('research', 'space:abcd1234', a.id, false).type, 'image/jpeg');
  assert.equal(u.read('research', 'space:other123', a.id, false), null); // another space cannot reach it
  assert.equal(u.read('research', 'space:abcd1234', a.id, true), null);
  u.putThumb('research', 'space:abcd1234', rule, a.id, jpeg({ exif: false, extra: false }));
  assert.equal(u.read('research', 'space:abcd1234', a.id, true).type, 'image/jpeg');
  assert.throws(() => u.put('research', 'space:abcd1234', { ...rule, maxBytes: 100 }, { bytes: jpeg(), by: 'u1' }), /over the limit/);
  u.put('research', 'space:abcd1234', rule, { bytes: png(), by: 'u2' });
  assert.throws(() => u.put('research', 'space:abcd1234', rule, { bytes: png(), by: 'u2' }), /already keeps 2/);
  assert.throws(() => u.put('research', 'space:../x', rule, { bytes: png(), by: 'u2' }), /bad scope/);
  assert.equal(u.read('research', 'space:abcd1234', '../../etc/passwd', false), null);
  assert.ok(u.usage('research').bytes > 0);
  assert.equal(u.remove('research', 'space:abcd1234', a.id), true);
  assert.equal(u.list('research', 'space:abcd1234').length, 1);
  assert.equal(u.remove('research', 'space:abcd1234', a.id), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`check-uploads: ${n} groups OK`);
