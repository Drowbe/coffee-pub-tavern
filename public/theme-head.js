// Light or dark before the first paint (GitHub #62). Loaded as a plain, blocking script in <head>, ahead of
// /theme.css, so a page never flashes the other mode: the light or dark this browser last picked (the header's
// switch, public/theme-mode.js) goes on <html data-theme-mode>. Nothing picked: no attribute, and /theme.css's
// default shows (the signed-in person's own mode, else the environment's). An external file, not an inline
// script, so a page's content security policy never has to allow inline code.
try {
  const mode = localStorage.getItem('app.themeMode');
  if (mode === 'light' || mode === 'dark') document.documentElement.dataset.themeMode = mode;
} catch {
  // no storage: the default mode shows
}
