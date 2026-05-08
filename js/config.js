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
