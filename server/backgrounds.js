// The pre-made background images that ship with Tavern (public/assets/images/backgrounds), read from the file names:
//   background-<theme>-<style>-<name>-<index>.webp   e.g. background-fantasy-pattern-orange-01.webp
// Each part is lower-case letters and digits (no hyphen inside a part), the index is two digits. A file that does not match is
// skipped and named once in the log, so a mistyped name is found. The list is read again when the folder changes.
const fs = require('fs');
const path = require('path');

const NAME = /^background-([a-z0-9]+)-([a-z0-9]+)-([a-z0-9]+)-(\d{2})\.webp$/;
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function parse(file) {
  const m = NAME.exec(file);
  if (!m) return null;
  const [, theme, style, name, index] = m;
  return { file, url: `/assets/images/backgrounds/${file}`, theme, style, name, index, label: `${title(theme)} · ${title(style)} · ${title(name)} ${index}` };
}

class Backgrounds {
  constructor(dir) {
    this.dir = dir;
    this.stamp = -1;
    this.list = [];
    this.warned = new Set();
  }

  all() {
    let stat;
    try {
      stat = fs.statSync(this.dir);
    } catch {
      return [];
    }
    if (stat.mtimeMs !== this.stamp) {
      this.stamp = stat.mtimeMs;
      const out = [];
      for (const file of fs.readdirSync(this.dir).sort()) {
        if (!/\.webp$/i.test(file)) continue;
        const item = parse(file);
        if (item) out.push(item);
        else if (!this.warned.has(file)) {
          this.warned.add(file);
          console.warn(`backgrounds: skipped ${file}: the name must be background-<theme>-<style>-<name>-<nn>.webp, lower-case letters and digits with no hyphen inside a part`);
        }
      }
      this.list = out;
    }
    return this.list;
  }
}

module.exports = { Backgrounds, parse };
