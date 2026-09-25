// A live readout of the space page's real geometry, for phones where the layout is wrong: open the
// call page with ?layout=1 (Manage > About > Troubleshooting has a link). Numbers are in CSS pixels,
// measured from the top of the page.
const box = document.createElement('pre');
box.style.cssText = 'position:fixed;top:96px;left:4px;right:4px;z-index:99999;margin:0;padding:6px;font:11px/1.3 ui-monospace,Menlo,monospace;background:rgba(255,255,255,.93);color:#000;border:2px solid magenta;pointer-events:none;white-space:pre-wrap';
document.body.appendChild(box);
const probe = document.createElement('div');
probe.style.cssText = 'position:absolute;visibility:hidden;width:1px;height:100dvh';
document.body.appendChild(probe);
const rect = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return `${sel}: none`;
  const r = el.getBoundingClientRect();
  return `${sel}: top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} h ${Math.round(r.height)}`;
};
function paint() {
  const vv = window.visualViewport;
  const cs = getComputedStyle(document.body);
  box.textContent = [
    `mode: standalone=${matchMedia('(display-mode: standalone)').matches}  ${innerWidth}x${innerHeight}  vv ${vv ? Math.round(vv.height) : '-'} offTop ${vv ? Math.round(vv.offsetTop) : '-'}`,
    `100dvh probe ${Math.round(probe.getBoundingClientRect().height)}  docEl.clientHeight ${document.documentElement.clientHeight}  --app-vh ${document.documentElement.style.getPropertyValue('--app-vh') || '-'}`,
    `body: position ${cs.position} height ${cs.height} top ${cs.top} bottom ${cs.bottom}`,
    rect('body'), rect('.topbar'), rect('#canvas'), rect('.video-bar'), rect('#subnav'),
    `subnav parent: ${document.querySelector('#subnav')?.parentElement?.tagName || '-'}`,
  ].join('\n');
}
setInterval(paint, 400);
paint();
