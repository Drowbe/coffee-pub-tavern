  // The map's style, built from the theme's colours (a light theme gets a light map) with the layer names of the
  // basemap schema the map file follows. Fewer layers than a general basemap on purpose: a calm ground for the pins.
  // No points of interest (the pins are those), no sprite. Pure, so it can be checked without a browser.

  // A colour as [r, g, b] (0 to 255), from what a computed style gives (rgb(), rgba(), color(srgb ...)) or a hex code.
  function rgbOf(text) {
    const t = String(text == null ? '' : text).trim();
    let m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    m = t.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
    m = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return null;
  }
  // `a` at `pct` percent over `b`, as a colour string the map accepts.
  const mixRgb = (a, b, pct) => `rgb(${[0, 1, 2].map((i) => Math.round(a[i] * pct / 100 + b[i] * (100 - pct) / 100)).join(',')})`;
  const rgbText = (a) => `rgb(${a.map((x) => Math.round(x)).join(',')})`;

  const DARK_TOKENS = { bg: [26, 18, 6], section: [38, 30, 22], text: [241, 232, 220], dim: [170, 158, 144], accent: [200, 135, 58], border: [70, 60, 50] };

  // The style. `t` holds the tokens as [r, g, b]; `o` is { tiles, glyphs }. `tiles` is the source address the map library
  // reads (pmtiles://<address of the file>).
  function buildStyle(t, o) {
    const tok = { ...DARK_TOKENS, ...t };
    const ground = tok.section;
    const font = ['Noto Sans Regular'];
    const fontBold = ['Noto Sans Medium'];
    const width = (a, b, c) => ['interpolate', ['exponential', 1.6], ['zoom'], 5, a, 14, b, 20, c];
    const road = (id, kinds, color, w, extra) => ({
      id,
      type: 'line',
      source: 'map',
      'source-layer': 'roads',
      filter: ['all', ['in', ['get', 'kind'], ['literal', kinds]], ['!=', ['get', 'is_tunnel'], true], ...(extra || [])],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': w },
    });
    const layers = [
      { id: 'background', type: 'background', paint: { 'background-color': rgbText(ground) } },
      { id: 'earth', type: 'fill', source: 'map', 'source-layer': 'earth', paint: { 'fill-color': rgbText(ground) } },
      { id: 'landcover', type: 'fill', source: 'map', 'source-layer': 'landcover', paint: { 'fill-color': mixRgb(tok.accent, ground, 7) } },
      { id: 'landuse', type: 'fill', source: 'map', 'source-layer': 'landuse', filter: ['in', ['get', 'kind'], ['literal', ['park', 'nature_reserve', 'national_park', 'forest', 'wood', 'grass', 'garden', 'golf_course', 'cemetery', 'pitch', 'playground', 'zoo', 'farmland', 'meadow', 'scrub']]], paint: { 'fill-color': mixRgb(tok.accent, ground, 9) } },
      { id: 'water', type: 'fill', source: 'map', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': mixRgb(tok.text, ground, 9) } },
      { id: 'waterway', type: 'line', source: 'map', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': mixRgb(tok.text, ground, 9), 'line-width': width(0.4, 1.6, 6) } },
      { id: 'buildings', type: 'fill', source: 'map', 'source-layer': 'buildings', minzoom: 15, paint: { 'fill-color': mixRgb(tok.text, ground, 6), 'fill-outline-color': mixRgb(tok.text, ground, 9) } },
      road('roads-path', ['path'], rgbText(tok.border), width(0.3, 0.8, 2), []),
      road('roads-minor', ['minor_road', 'other'], rgbText(tok.border), width(0.4, 1.6, 9), []),
      road('roads-medium', ['medium_road'], mixRgb(tok.text, ground, 11), width(0.6, 2.4, 12), []),
      road('roads-major', ['major_road', 'highway'], mixRgb(tok.text, ground, 16), width(0.8, 3.4, 16), []),
      { id: 'boundaries', type: 'line', source: 'map', 'source-layer': 'boundaries', paint: { 'line-color': rgbText(tok.dim), 'line-width': 0.8, 'line-dasharray': [3, 2], 'line-opacity': 0.7 } },
      {
        id: 'places-local',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['in', ['get', 'kind_detail'], ['literal', ['neighbourhood', 'macrohood', 'suburb', 'quarter']]],
        minzoom: 12,
        layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.06, 'text-max-width': 8 },
        paint: { 'text-color': rgbText(tok.dim), 'text-halo-color': rgbText(ground), 'text-halo-width': 1.5 },
      },
      {
        id: 'places-city',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['==', ['get', 'kind'], 'locality'],
        layout: { 'text-field': ['get', 'name'], 'text-font': fontBold, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 12, 16], 'text-max-width': 8, 'symbol-sort-key': ['get', 'min_zoom'] },
        paint: { 'text-color': rgbText(tok.text), 'text-halo-color': rgbText(ground), 'text-halo-width': 1.6 },
      },
      {
        id: 'places-region',
        type: 'symbol',
        source: 'map',
        'source-layer': 'places',
        filter: ['in', ['get', 'kind'], ['literal', ['country', 'region']]],
        maxzoom: 8,
        layout: { 'text-field': ['get', 'name'], 'text-font': fontBold, 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 },
        paint: { 'text-color': rgbText(tok.dim), 'text-halo-color': rgbText(ground), 'text-halo-width': 1.5 },
      },
    ];
    return { version: 8, glyphs: o.glyphs, sources: { map: { type: 'vector', url: o.tiles } }, layers };
  }
