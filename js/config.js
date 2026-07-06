/* ==============================================================
 * Global JS configuration. Pulls colors from CSS theme variables
 * so JS-side rendering (canvases, heatmaps) stays in sync with CSS.
 *
 * To retune the visual style: edit css/theme.css for colors and
 * fonts. To retune simulation parameters: edit this file.
 * ============================================================== */
(function (global) {
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function makeTheme() {
    return {
      dirichlet:  cssVar('--color-dirichlet', '#b8362a'),
      neumann:    cssVar('--color-neumann',   '#2a5fb8'),
      interface:  cssVar('--color-interface', '#e88c30'),
      tileGrid:   cssVar('--color-tile-grid', '#888'),
      walk:       cssVar('--color-walk',      '#1a1a1a'),
      accent:     cssVar('--color-accent',    '#2a5fb8'),
      surface:    cssVar('--color-surface',   '#fff'),
      bg:         cssVar('--color-bg',        '#fafaf7'),
      text:       cssVar('--color-text',      '#1a1a1a'),
      textMuted:  cssVar('--color-text-muted','#6b6b6b'),
      rule:       cssVar('--color-rule',      '#e2e2dc'),
      neumannFill: cssVar('--color-neumann-fill', 'rgba(42,95,184,0.07)'),
      hmLow:      cssVar('--hm-low',  '#2a5fb8'),
      hmMid:      cssVar('--hm-mid',  '#f5f0e6'),
      hmHigh:     cssVar('--hm-high', '#b8362a'),
      fontMono:   cssVar('--font-mono', 'monospace'),
      fontBody:   cssVar('--font-body', 'sans-serif'),
    };
  }

  // Recompute on demand (after stylesheet loads)
  global.WoDS = global.WoDS || {};
  global.WoDS.theme = makeTheme;

  // ---- Per-figure color overrides --------------------------------
  // Merged onto the base theme by WoDS.themeFor(root), keyed on the
  // figure's root element id. Edit these to retune a figure's palette
  // (e.g. to match presentation slides) without touching the figure
  // code or the global CSS theme. Any key not listed falls back to
  // the CSS-derived theme above. Relevant keys:
  //   dirichlet   – outer (Dirichlet) boundary stroke
  //   neumann     – obstacle (Neumann) dashed stroke
  //   neumannFill – fill of the greyed Neumann region
  //   walk        – Walk-on-Spheres/Stars trajectory segment
  //   accent      – sphere/star outlines and active markers
  global.WoDS.figureColors = {
    // Slide palette: Dirichlet + Neumann both black (Neumann still
    // distinguished by its dashed stroke and grey fill); WoS
    // trajectory segments a dark blue instead of black.
    i1: { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.06)', walk: '#3a609c' },
    i2: { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.06)', walk: '#3a609c' },
    i3: { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.10)', walk: '#3a609c' },
    i3b: { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.10)', walk: '#3a609c' },
    subkernel: { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.10)', walk: '#3a609c' },
    binop: { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.10)', walk: '#3a609c' },
    'coedge-fig': { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.10)', walk: '#3a609c' },
    'pipeline-fig': { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.06)', walk: '#3a609c' },
    'locality-fig': { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.06)' },
    // tradeoff-fig: only the left (domain) panel is routed through themeFor;
    // the right (plot) panel keeps the base theme.
    'tradeoff-fig': { dirichlet: '#000000', neumann: '#000000', neumannFill: 'rgba(0,0,0,0.06)' },
  };

  // Base theme with any per-figure overrides applied. Pass the
  // figure's root element (its id selects the override set).
  global.WoDS.themeFor = function (root) {
    const t = makeTheme();
    const id = root && root.id;
    const ov = (id && global.WoDS.figureColors[id]) || {};
    return Object.assign(t, ov);
  };

  // Simulation defaults
  global.WoDS.config = {
    epsilon: 0.005,        // boundary tolerance (in unit square coords)
    rmin:    0.005,        // WoSt minimum star radius (Sec. 4.4.3)
    maxSteps: 5000,        // cap on a single walk
    walksPerSecond: 30,    // animation walk rate
    histBins: 15,
    histMaxSteps: 800,     // x-axis cap for histograms (log scale)
  };
})(window);
