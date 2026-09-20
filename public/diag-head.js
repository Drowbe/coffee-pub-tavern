// Runs before the page is parsed, so the viewport and status bar settings from the address take effect.
const q = new URLSearchParams(location.search);
const fit = q.get('fit') === 'auto' ? 'auto' : 'cover';
const bar = q.get('bar') === 'default' ? 'default' : 'black-translucent';
document.write(`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=${fit}">`);
document.write(`<meta name="apple-mobile-web-app-status-bar-style" content="${bar}">`);
