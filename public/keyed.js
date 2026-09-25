// A module's keyed page: /<path>/<key>?s=<access key>&... (see "Keyed pages" in api-module-sdk.md).
// The path is claimed by one enabled module (surfaces.keyed in its module.json); <key> is the person the
// page is about; the access key stands in for a sign-in. The module runs in the page, with the host
// drawing media into it (host.media.watch), so a keyed page is never a sandboxed frame.
import { api, setAccessKey } from '/brand.js';
import { mountModule } from '/module-host.js';

const [, rawPath, rawKey] = location.pathname.split('/');
const path = decodeURIComponent(rawPath || '');
const subject = decodeURIComponent(rawKey || '');
const params = new URLSearchParams(location.search);
setAccessKey(params.get('s') || '');
// What the link asked for (kind=player, plate=1 ...), for the module; the key itself is not its business.
const query = Object.fromEntries(params.entries());
delete query.s;

async function start() {
  const { page } = await api('GET', `/api/pages/${encodeURIComponent(path)}`);
  if (page.module.runMode !== 'page') throw new Error(`the ${page.module.name} module must run in the page to serve this`);
  document.title = page.module.name;
  mountModule({
    module: { id: page.module.id, version: page.module.version, scope: ['environment'] },
    container: document.getElementById('module-frame'),
    scope: 'environment',
    entry: page.entry,
    keyed: { path, subject, query },
    onTitle: (title) => { document.title = title || page.module.name; },
  });
}

start().catch((err) => {
  const note = document.getElementById('keyed-missing');
  note.textContent = err.status === 404 ? 'No module serves this page.' : err.status === 403 || err.status === 401 ? 'This page needs the access key.' : `This page could not start: ${err.message}`;
  note.hidden = false;
});
