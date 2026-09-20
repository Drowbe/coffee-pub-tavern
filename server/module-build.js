// Builds a module's zip from its source folder (modules/<id>/): module.json plus src/<id>.html,
// .css and .js, with the CSS and JS inlined into the HTML (a module page loads nothing else; see
// documentation/api/api-module-sdk.md). Used by tools/build-module.mjs to write a zip to upload,
// and by the server to install or update a module that ships with Tavern without uploading one.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

function zipFiles(files) {
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
  return Buffer.concat([...parts, centralBuf, end]);
}

// The module in `dir`, built: { manifest, fileCount, zip }. Throws if the folder is not a module.
function buildModule(dir) {
  const manifestPath = path.join(dir, 'module.json');
  if (!fs.existsSync(manifestPath)) throw new Error('that folder has no module.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const read = (name, ext) => fs.readFileSync(path.join(dir, 'src', `${name}.${ext}`), 'utf8');
  // Code more than one of the module's pages shares can live in src/<id>-lib.js, put where the page's script has
  // `/*__LIB__*/`. Function replacements throughout, so "$&" and friends in the code are not treated as patterns.
  const lib = fs.existsSync(path.join(dir, 'src', `${manifest.id}-lib.js`)) ? read(`${manifest.id}-lib`, 'js') : '';
  const build = (name) => read(name, 'html')
    .replace('/*__CSS__*/', () => read(name, 'css'))
    .replace('/*__JS__*/', () => read(name, 'js').replace('/*__LIB__*/', () => lib).replace(/<\/script/gi, '<\\/script'));
  // The page and the panel are one file; a dashboard widget is its own (src/<id>-widget.*).
  const shared = build(manifest.id);
  const files = [['module.json', fs.readFileSync(manifestPath)]];
  const seen = new Set();
  for (const [surface, def] of Object.entries(manifest.surfaces || {})) {
    if (seen.has(def.entry)) continue;
    seen.add(def.entry);
    files.push([def.entry, Buffer.from(surface === 'widget' ? build(`${manifest.id}-widget`) : shared)]);
  }
  return { manifest, fileCount: files.length, zip: zipFiles(files) };
}

// The modules that ship with this Tavern: a folder under modules/ with a module.json and a src/.
function bundledModules(rootDir) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(rootDir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(name)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, name, 'module.json'), 'utf8'));
      if (manifest.id === name && fs.existsSync(path.join(rootDir, name, 'src'))) out.push(manifest);
    } catch {
      // not a module folder
    }
  }
  return out;
}

module.exports = { buildModule, bundledModules };
