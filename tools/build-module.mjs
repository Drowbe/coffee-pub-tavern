#!/usr/bin/env node
/*
 * build-module.mjs -- build a Tavern module zip from a source folder.
 *
 *   node tools/build-module.mjs modules/calendar
 *
 * A module folder holds a module.json and src/<id>.html, src/<id>.css and src/<id>.js. The build inlines the
 * CSS and JS into the HTML (a module page loads nothing else; see documentation/api/api-module-sdk.md),
 * writes that page under each surface entry the manifest names, and zips module.json plus those pages into
 * modules/dist/<id>-<version>.zip, ready to upload on Manage > Modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dir = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(dir, 'module.json'))) {
  console.error('usage: node tools/build-module.mjs <module folder containing module.json>');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
const src = (ext) => fs.readFileSync(path.join(dir, 'src', `${manifest.id}.${ext}`), 'utf8');
// A function replacement, so "$&" and friends in the code are not treated as patterns.
const page = src('html')
  .replace('/*__CSS__*/', () => src('css'))
  .replace('/*__JS__*/', () => src('js').replace(/<\/script/gi, '<\\/script'));

const entries = [...new Set(Object.values(manifest.surfaces || {}).map((s) => s.entry))];
const files = [['module.json', fs.readFileSync(path.join(dir, 'module.json'))], ...entries.map((e) => [e, Buffer.from(page)])];

// A small zip writer: deflate, no extras.
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const parts = [];
const central = [];
let offset = 0;
for (const [name, data] of files) {
  const nameBuf = Buffer.from(name);
  const packed = zlib.deflateRawSync(data);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  parts.push(local, nameBuf, packed);
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(20, 6);
  head.writeUInt16LE(8, 10);
  head.writeUInt32LE(crc, 16);
  head.writeUInt32LE(packed.length, 20);
  head.writeUInt32LE(data.length, 24);
  head.writeUInt16LE(nameBuf.length, 28);
  head.writeUInt32LE(offset, 42);
  central.push(head, nameBuf);
  offset += local.length + nameBuf.length + packed.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const outDir = path.join(path.dirname(dir), 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${manifest.id}-${manifest.version}.zip`);
fs.writeFileSync(out, Buffer.concat([...parts, centralBuf, end]));
console.log(`built ${path.relative(process.cwd(), out)} (${files.length} files, ${fs.statSync(out).size} bytes)`);
