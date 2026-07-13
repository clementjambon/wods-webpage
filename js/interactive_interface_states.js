/* Figure — the state space of the discrete interface Markov chain.
 *
 * Single pane, in the same style as the #subkernel / #binop / #coedgeop left
 * panes: the 12-obstacle scene + an n×n tile grid, Dirichlet outer boundary,
 * clipped Neumann obstacles. But here there is NO selected subdomain — we show
 * the WHOLE decomposition and, on top of it, every state of the discrete
 * Markov chain that lives on the *interfaces* (not inside the tiles).
 *
 * Each interior interface segment (one shared tile-edge) is discretized into R
 * stations, exactly as in #coedgeop. The union of those stations over every
 * interior interface is the chain's state space. States that fall strictly
 * inside a (clipped) Neumann obstacle are not real degrees of freedom, so they
 * are filtered out.
 *
 * Two levers: the tiling resolution n and the interface binning resolution R.
 * A show/hide toggle fades the states in and out, and the frame can be exported
 * as SVG (vector) or PNG — the SVG replays the very same drawing calls into
 * vector elements, so it can never drift from the on-screen preview. */
(function (W) {
  const U = W.WoDS.util;
  const Sc = W.WoDS.scenes;

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const canvas = root.querySelector('canvas[data-role="domain"]');
    const tileSlider = root.querySelector('input[data-role="tiles"]');
    const tileLabel = root.querySelector('[data-role="tiles-label"]');
    const resSlider = root.querySelector('input[data-role="res"]');
    const resLabel = root.querySelector('[data-role="res-label"]');
    const nodeSlider = root.querySelector('input[data-role="node-size"]');
    const nodeLabel = root.querySelector('[data-role="node-size-label"]');
    const lineWidthSlider = root.querySelector('input[data-role="line-width"]');
    const lineWidthLabel = root.querySelector('[data-role="line-width-label"]');
    const toggleStatesBtn = root.querySelector('button[data-role="toggle-states"]');
    const toggleIfaceBtn = root.querySelector('button[data-role="toggle-iface"]');
    const toggleBoundaryBtn = root.querySelector('button[data-role="toggle-boundary"]');
    const exportSvgBtn = root.querySelector('button[data-role="export-svg"]');
    const exportPngBtn = root.querySelector('button[data-role="export-png"]');
    const statusLabel = root.querySelector('[data-role="status"]');

    const W0 = 360, H0 = 360, PAD = 56, SQ = W0 - 2 * PAD;
    // Not const: the SVG export swaps in a recorder with the same interface
    // and re-runs render(), so there is only ever one drawing path.
    let ctx = U.fitCanvas(canvas, W0, H0);

    let n = parseInt(tileSlider.value);   // tiling resolution
    let R = parseInt(resSlider.value);    // stations per tile-edge (interface binning)
    let nodeR = nodeSlider ? parseFloat(nodeSlider.value) : 3;
    let ifaceWidth = lineWidthSlider ? parseFloat(lineWidthSlider.value) : 1.5;
    let showStates = true;
    let showIface = true;
    let showBoundary = false;
    let statesReveal = 1;     // eased 0..1 fade of the interface state dots
    let boundaryReveal = 0;   // eased 0..1 fade of the boundary state dots
    let lastT = null;
    let exportScale = 4;    // PNG export multiplier

    const baseScene = Sc.layout(12);
    const stateColor = theme.interface;   // interface states share the interface color
    const boundaryColor = '#000000';      // outer Dirichlet-boundary states are black

    const toScreen = (x, y) => [PAD + x * SQ, PAD + (1 - y) * SQ];

    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
    function approach(cur, target, rate) {
      if (cur < target) return Math.min(target, cur + rate);
      if (cur > target) return Math.max(target, cur - rate);
      return cur;
    }

    // ---- State space ------------------------------------------------
    // Strictly-inside test against the clipped Neumann obstacles: a state on
    // an interface that lands inside an obstacle is not a real DOF.
    function pointInObstacle(x, y) {
      for (const r of baseScene.rects) {
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
      }
      return false;
    }

    // Every interior interface segment (one shared tile-edge) carries R
    // stations at the bin centers (i+0.5)/R along its tile-length. The union
    // over all interior vertical and horizontal interfaces is the chain's
    // state space; states inside an obstacle are dropped.
    let states = [];
    let boundaryStates = [];
    let nDropped = 0;
    function computeStates() {
      states = [];
      boundaryStates = [];
      nDropped = 0;
      const invN = 1 / n;
      // Vertical interfaces: x = k/n, k = 1..n-1; one segment per row.
      for (let k = 1; k < n; k++) {
        const x = k * invN;
        for (let r = 0; r < n; r++) {
          for (let i = 0; i < R; i++) {
            const y = (r + (i + 0.5) / R) * invN;
            if (pointInObstacle(x, y)) { nDropped++; continue; }
            states.push([x, y]);
          }
        }
      }
      // Horizontal interfaces: y = k/n, k = 1..n-1; one segment per column.
      for (let k = 1; k < n; k++) {
        const y = k * invN;
        for (let c = 0; c < n; c++) {
          for (let i = 0; i < R; i++) {
            const x = (c + (i + 0.5) / R) * invN;
            if (pointInObstacle(x, y)) { nDropped++; continue; }
            states.push([x, y]);
          }
        }
      }
      // Outer Dirichlet boundary: the four edges of the unit square, each tile-
      // edge split into R stations. Obstacles are strictly interior, so nothing
      // is filtered here.
      for (let c = 0; c < n; c++) {
        for (let i = 0; i < R; i++) {
          const t = (c + (i + 0.5) / R) * invN;
          boundaryStates.push([t, 0]);   // bottom
          boundaryStates.push([t, 1]);   // top
          boundaryStates.push([0, t]);   // left
          boundaryStates.push([1, t]);   // right
        }
      }
      updateStatus();
    }

    function updateStatus() {
      if (!statusLabel) return;
      const bnd = showBoundary ? ` · ${boundaryStates.length} boundary states` : '';
      statusLabel.textContent =
        `${states.length} interface states · ${nDropped} filtered inside obstacles${bnd}`;
    }

    // ---- Rendering --------------------------------------------------
    function drawObstacles() {
      ctx.save();
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const r of baseScene.rects) {
        const tl = toScreen(r.x0, r.y1);
        ctx.fillRect(tl[0], tl[1], (r.x1 - r.x0) * SQ, (r.y1 - r.y0) * SQ);
        ctx.strokeRect(tl[0], tl[1], (r.x1 - r.x0) * SQ, (r.y1 - r.y0) * SQ);
      }
      ctx.restore();
    }

    function drawInterfaces() {
      ctx.save();
      ctx.strokeStyle = theme.interface;
      ctx.lineWidth = ifaceWidth;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        let p0 = toScreen(t, 0), p1 = toScreen(t, 1);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        p0 = toScreen(0, t); p1 = toScreen(1, t);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
      ctx.restore();
    }

    function drawDots(list, color, reveal) {
      if (reveal <= 0.001) return;
      const e = easeOut(Math.min(1, reveal));
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 1;
      ctx.globalAlpha = e;
      const r = nodeR * (0.4 + 0.6 * e);   // small grow-in with the fade
      for (const s of list) {
        const [px, py] = toScreen(s[0], s[1]);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    function render() {
      ctx.clearRect(0, 0, W0, H0);

      if (showIface) drawInterfaces();

      const o = toScreen(0, 1);
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.dirichlet;
      ctx.strokeRect(o[0], o[1], SQ, SQ);
      drawObstacles();

      drawDots(boundaryStates, boundaryColor, boundaryReveal);
      drawDots(states, stateColor, statesReveal);
    }

    function frame(t) {
      const dt = lastT == null ? 0 : t - lastT;
      lastT = t;
      statesReveal = approach(statesReveal, showStates ? 1 : 0, dt / 500);
      boundaryReveal = approach(boundaryReveal, showBoundary ? 1 : 0, dt / 500);
      render();
    }

    // ---- Export -----------------------------------------------------
    // Both paths freeze the reveal at its resting state so the exported frame
    // is clean regardless of any in-flight fade.
    function withResting(produce) {
      const prevReveal = statesReveal;
      const prevBoundary = boundaryReveal;
      statesReveal = showStates ? 1 : 0;
      boundaryReveal = showBoundary ? 1 : 0;
      const out = produce();
      statesReveal = prevReveal;
      boundaryReveal = prevBoundary;
      return out;
    }

    function renderToSVG() {
      const rec = W.WoDS.svgRecorder(W0, H0);
      const live = ctx;
      ctx = rec.ctx;
      let svg;
      try {
        svg = withResting(() => { render(); return rec.toSVG(); });
      } finally {
        ctx = live;
      }
      render();
      return svg;
    }

    function renderToPNG() {
      const prevScale = W.WoDS.captureScale;
      W.WoDS.captureScale = exportScale;
      ctx = U.fitCanvas(canvas, W0, H0);
      const url = withResting(() => { render(); return canvas.toDataURL('image/png'); });
      W.WoDS.captureScale = prevScale;
      ctx = U.fitCanvas(canvas, W0, H0);
      render();
      return url;
    }

    function download(url, name, revoke) {
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // ---- Interaction ------------------------------------------------
    if (tileSlider) {
      tileSlider.addEventListener('input', () => {
        n = parseInt(tileSlider.value);
        if (tileLabel) tileLabel.textContent = `${n}×${n}`;
        computeStates();
      });
    }
    if (resSlider) {
      resSlider.addEventListener('input', () => {
        R = parseInt(resSlider.value);
        if (resLabel) resLabel.textContent = `${R}`;
        computeStates();
      });
    }
    if (nodeSlider) {
      nodeSlider.addEventListener('input', () => {
        nodeR = parseFloat(nodeSlider.value);
        if (nodeLabel) nodeLabel.textContent = nodeR.toFixed(1);
      });
    }
    if (lineWidthSlider) {
      lineWidthSlider.addEventListener('input', () => {
        ifaceWidth = parseFloat(lineWidthSlider.value);
        if (lineWidthLabel) lineWidthLabel.textContent = ifaceWidth.toFixed(1);
      });
    }
    if (toggleStatesBtn) {
      const upd = () => { toggleStatesBtn.textContent = showStates ? 'Hide states' : 'Show states'; };
      toggleStatesBtn.addEventListener('click', () => { showStates = !showStates; upd(); });
      upd();
    }
    if (toggleIfaceBtn) {
      const upd = () => { toggleIfaceBtn.textContent = showIface ? 'Hide interfaces' : 'Show interfaces'; };
      toggleIfaceBtn.addEventListener('click', () => { showIface = !showIface; upd(); });
      upd();
    }
    if (toggleBoundaryBtn) {
      const upd = () => { toggleBoundaryBtn.textContent = showBoundary ? 'Hide boundary states' : 'Show boundary states'; };
      toggleBoundaryBtn.addEventListener('click', () => { showBoundary = !showBoundary; upd(); updateStatus(); });
      upd();
    }
    if (exportSvgBtn) {
      exportSvgBtn.addEventListener('click', () => {
        const blob = new Blob([renderToSVG()], { type: 'image/svg+xml;charset=utf-8' });
        download(URL.createObjectURL(blob), `interface-states-${n}x${n}-R${R}.svg`, true);
      });
    }
    if (exportPngBtn) {
      exportPngBtn.addEventListener('click', () => {
        download(renderToPNG(), `interface-states-${n}x${n}-R${R}@${exportScale}x.png`);
      });
    }

    if (tileLabel) tileLabel.textContent = `${n}×${n}`;
    if (resLabel) resLabel.textContent = `${R}`;
    if (nodeLabel) nodeLabel.textContent = nodeR.toFixed(1);
    if (lineWidthLabel) lineWidthLabel.textContent = ifaceWidth.toFixed(1);
    computeStates();
    U.animLoop(root, frame);
  }

  W.WoDS.interactiveInterfaceStates = W.WoDS.lazyFigure(init);
})(window);
