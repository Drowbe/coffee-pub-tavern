// Reads just the fixed 127-byte header of a PMTiles archive (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md)
// to learn its own zoom range, without touching the rest of the file, which can be gigabytes. The same header shape
// modules/maps/src/maps-lib-b-pmtiles.js reads in the browser (its own bytesToHeader) -- kept in step with it, so an
// admin's "Map files" table can say how detailed each file is (street-level or not) for any .pmtiles file there,
// whether it was cut by "Add a region" or dropped in by hand.
'use strict';

const fs = require('fs');

const HEADER_BYTES = 127;

// { minZoom, maxZoom }, or null if this isn't readable as a PMTiles file (wrong magic or a spec version newer than
// this reads, too short, or the file could not be opened).
function pmtilesZoomRange(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    if (fs.readSync(fd, buf, 0, HEADER_BYTES, 0) < HEADER_BYTES) return null;
    if (buf.readUInt16LE(0) !== 19792) return null; // "PM", the same fast check the JS reader uses
    if (buf.readUInt8(7) > 3) return null; // a spec version newer than this header shape
    const minZoom = buf.readUInt8(100);
    const maxZoom = buf.readUInt8(101);
    if (maxZoom < minZoom) return null;
    return { minZoom, maxZoom };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already gone */ } }
  }
}

module.exports = { pmtilesZoomRange, HEADER_BYTES };
