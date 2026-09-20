const out = document.getElementById('out');
const h = (id) => Math.round(document.getElementById(id).getBoundingClientRect().height);
const pad = (id, side) => Math.round(parseFloat(getComputedStyle(document.getElementById(id))[`padding${side}`]) || 0);
const rect = (id) => {
  const r = document.getElementById(id).getBoundingClientRect();
  return `top ${Math.round(r.top)} bottom ${Math.round(r.bottom)}`;
};
function paint() {
  const vv = window.visualViewport;
  const lines = [
    `page: ${location.pathname}${location.search}`,
    `standalone: display-mode=${matchMedia('(display-mode: standalone)').matches} navigator.standalone=${navigator.standalone}`,
    `UA: ${navigator.userAgent}`,
    `screen: ${screen.width} x ${screen.height}   dpr ${devicePixelRatio}`,
    `window.inner: ${innerWidth} x ${innerHeight}   outer: ${outerWidth} x ${outerHeight}`,
    `visualViewport: ${vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)} offsetTop ${Math.round(vv.offsetTop)} pageTop ${Math.round(vv.pageTop)} scale ${vv.scale}` : 'none'}`,
    `documentElement.clientHeight: ${document.documentElement.clientHeight}`,
    `100vh ${h('p-vh')}   100dvh ${h('p-dvh')}   100svh ${h('p-svh')}   100lvh ${h('p-lvh')}   100% ${h('p-pct')}`,
    `safe-area-inset  top ${pad('p-top', 'Top')}  bottom ${pad('p-bottom', 'Bottom')}  left ${pad('p-left', 'Left')}  right ${pad('p-right', 'Right')}`,
    `fixed probes (bar heights 36):  top:0 -> ${rect('fx-top')};  bottom:0 -> ${rect('fx-bottom')};  bottom:env() -> ${rect('fx-bottom-env')}`,
    `scrollY ${Math.round(scrollY)}`,
    ``,
    `Magenta frame = a fixed element with inset:0. Blue bar = bottom:0. Green bar = bottom:env(safe-area-inset-bottom) (sits above blue).`,
  ];
  out.textContent = lines.join('\n');
}
for (const t of ['resize', 'scroll', 'orientationchange']) addEventListener(t, paint);
window.visualViewport?.addEventListener('resize', paint);
window.visualViewport?.addEventListener('scroll', paint);
setInterval(paint, 500);
paint();
