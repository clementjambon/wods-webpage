/* Combined figure — pick a subdomain of the decomposition (left) and
 * estimate its local first-passage solution operator / Poisson kernel
 * (right).
 *
 * Left pane: the same 12-obstacle scene as I2 with an n×n tile grid.
 * Click a tile to select a subdomain. Right pane: that tile remapped to
 * the unit square, with the obstacles clipped to it (Neumann) and ALL
 * four tile edges treated as absorbing exits — whether they were the
 * global Dirichlet boundary or artificial interfaces, locally they are
 * the first-passage boundary. The Poisson kernel P(x, ·) is then
 * estimated exactly like I3, reusing the shared WoS/WoSt solver.
 *
 * Caveat: if an obstacle straddles a tile edge, part of that edge is
 * physically Neumann; here the whole perimeter is absorbing. Exact when
 * obstacles sit fully inside the tile, a mild approximation otherwise. */
(function (W) {
  const U = W.WoDS.util;
  const S = W.WoDS.solver;
  const Sc = W.WoDS.scenes;

  const NBINS = 96;
  const TARGET_SAMPLES = 8000;
  const CHUNK_BUDGET_MS = 25;

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const decompCanvas = root.querySelector('canvas[data-role="decomp"]');
    const kernelCanvas = root.querySelector('canvas[data-role="kernel"]');
    const tileSlider = root.querySelector('input[data-role="tiles"]');
    const tileLabel = root.querySelector('[data-role="tiles-label"]');
    const statusLabel = root.querySelector('[data-role="status"]');
    const recomputeBtn = root.querySelector('button[data-role="recompute"]');
    const toggle = root.querySelector('[data-role="solver-toggle"]');
    const showKernelCb = root.querySelector('input[data-role="show-kernel"]');

    const W0 = 360, H0 = 360, PAD = 56, SQ = W0 - 2 * PAD;
    const dctx = U.fitCanvas(decompCanvas, W0, H0);
    const kctx = U.fitCanvas(kernelCanvas, W0, H0);

    let solverMode = toggle ? toggle.querySelector('input:checked').value : 'wost';
    // Toggles the source x and the kernel histogram together on the right pane.
    let showKernel = showKernelCb ? showKernelCb.checked : true;

    const baseScene = Sc.layout(12); // Dirichlet walls + 12 Neumann rects
    let n = parseInt(tileSlider.value);
    let sel = { i: Math.floor(n / 2), j: Math.floor(n / 2) };

    // Local (subdomain) scene fed to the solver, in unit coords.
    const localScene = {
      walls: [
        { x0: 0, y0: 1, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 1, y0: 0, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 1, y1: 0, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 0, y1: 1, kind: 'D', value: 0 },
      ],
      rects: [], circles: [], mode: solverMode,
    };

    const source = { x: 0.5, y: 0.5 };
    const prob = new Float32Array(NBINS);
    let totalSamples = 0;
    let estimating = false;
    let cap = TARGET_SAMPLES; // sample target for the current estimate

    function toScreen(x, y) { return [PAD + x * SQ, PAD + (1 - y) * SQ]; }

    // ---- Subdomain construction -------------------------------------
    function tileBounds() {
      const L = 1 / n;
      return { a: sel.i * L, b: sel.j * L, L };
    }

    function rebuildLocalScene() {
      const { a, b, L } = tileBounds();
      const rects = [];
      for (const r of baseScene.rects) {
        const x0 = Math.max(r.x0, a), x1 = Math.min(r.x1, a + L);
        const y0 = Math.max(r.y0, b), y1 = Math.min(r.y1, b + L);
        if (x1 - x0 > 1e-4 && y1 - y0 > 1e-4) {
          rects.push({
            x0: (x0 - a) / L, y0: (y0 - b) / L,
            x1: (x1 - a) / L, y1: (y1 - b) / L, kind: 'N',
          });
        }
      }
      localScene.rects = rects;
      localScene.mode = solverMode;
      ensureSourceOutside();
      resetEstimate();
    }

    function pointInObstacle(x, y, slack) {
      slack = slack || 0;
      for (const r of localScene.rects) {
        if (x > r.x0 - slack && x < r.x1 + slack &&
            y > r.y0 - slack && y < r.y1 + slack) return true;
      }
      return false;
    }

    function ensureSourceOutside() {
      if (!pointInObstacle(source.x, source.y, 0.02)) {
        source.x = Math.max(0.04, Math.min(0.96, source.x));
        source.y = Math.max(0.04, Math.min(0.96, source.y));
        return;
      }
      for (let i = 0; i < 64; i++) {
        const ang = i * 2 * Math.PI / 64;
        for (let r = 0.05; r < 0.7; r += 0.04) {
          const x = source.x + Math.cos(ang) * r;
          const y = source.y + Math.sin(ang) * r;
          if (x < 0.04 || x > 0.96 || y < 0.04 || y > 0.96) continue;
          if (pointInObstacle(x, y, 0.02)) continue;
          source.x = x; source.y = y; return;
        }
      }
    }

    // ---- Perimeter parametrization (matches I3) ----------------------
    function paramOnPerimeter(x, y) {
      const dB = Math.abs(y - 0), dR = Math.abs(x - 1);
      const dT = Math.abs(y - 1), dL = Math.abs(x - 0);
      const m = Math.min(dB, dR, dT, dL);
      if (m === dB) return 0 + Math.min(1, Math.max(0, x));
      if (m === dR) return 1 + Math.min(1, Math.max(0, y));
      if (m === dT) return 2 + Math.min(1, Math.max(0, 1 - x));
      return 3 + Math.min(1, Math.max(0, 1 - y));
    }

    function perimeterToXY(s) {
      s = ((s % 4) + 4) % 4;
      if (s < 1) return [s, 0, 0, -1];
      if (s < 2) return [1, s - 1, 1, 0];
      if (s < 3) return [3 - s, 1, 0, 1];
      return [0, 4 - s, -1, 0];
    }

    // ---- Estimation -------------------------------------------------
    function clearBins() { prob.fill(0); totalSamples = 0; }

    function resetEstimate() {
      clearBins();
      cap = TARGET_SAMPLES;
      estimating = true;
    }

    function moreSamples() {
      cap = totalSamples + 8000;
      estimating = true;
    }

    // Accumulate a time-budgeted batch of samples for the current frame.
    function stepEstimate() {
      if (!estimating) return;
      const t0 = performance.now();
      while (totalSamples < cap && performance.now() - t0 < CHUNK_BUDGET_MS) {
        const r = S.walk(localScene, source.x, source.y, false);
        if (r.kind === 'D') {
          const s = paramOnPerimeter(r.endX, r.endY);
          const b = Math.min(NBINS - 1, Math.max(0, Math.floor(s / 4 * NBINS)));
          prob[b] += 1;
        }
        totalSamples++;
      }
      if (statusLabel) {
        statusLabel.textContent =
          `P(x, ·) — samples: ${totalSamples}${totalSamples < cap ? ' …' : ''}`;
      }
      if (totalSamples >= cap) estimating = false;
    }

    // Persistent paint loop. Both canvases are redrawn every frame so a
    // resolution boost from the capture tool — capture.js re-fits the
    // canvas, which clears its backing store — is repainted immediately
    // instead of leaving a blank white canvas. It also drives sampling.
    function frame() {
      stepEstimate();
      drawDecomp();
      renderKernel();
    }

    // ---- Rendering --------------------------------------------------
    function drawObstacles(ctx, rects) {
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const r of rects) {
        const tl = toScreen(r.x0, r.y1);
        const w = (r.x1 - r.x0) * SQ, h = (r.y1 - r.y0) * SQ;
        ctx.fillRect(tl[0], tl[1], w, h);
        ctx.strokeRect(tl[0], tl[1], w, h);
      }
      ctx.setLineDash([]);
    }

    function drawDecomp() {
      dctx.clearRect(0, 0, W0, H0);
      const { a, b, L } = tileBounds();
      const tl = toScreen(a, b + L); // top-left of selected tile

      // Selected-tile highlight.
      dctx.fillStyle = 'rgba(58,96,156,0.12)';
      dctx.fillRect(tl[0], tl[1], L * SQ, L * SQ);

      // Tile grid.
      dctx.strokeStyle = theme.interface;
      dctx.lineWidth = 1.5;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        let p0 = toScreen(t, 0), p1 = toScreen(t, 1);
        dctx.beginPath(); dctx.moveTo(p0[0], p0[1]); dctx.lineTo(p1[0], p1[1]); dctx.stroke();
        p0 = toScreen(0, t); p1 = toScreen(1, t);
        dctx.beginPath(); dctx.moveTo(p0[0], p0[1]); dctx.lineTo(p1[0], p1[1]); dctx.stroke();
      }

      // Outer Dirichlet square.
      const o = toScreen(0, 1);
      dctx.lineWidth = 3;
      dctx.strokeStyle = theme.dirichlet;
      dctx.strokeRect(o[0], o[1], SQ, SQ);

      // Neumann obstacles (full scene).
      drawObstacles(dctx, baseScene.rects);

      // Selected-tile outline.
      dctx.lineWidth = 2.5;
      dctx.strokeStyle = theme.accent;
      dctx.strokeRect(tl[0], tl[1], L * SQ, L * SQ);
    }

    function renderKernel() {
      kctx.clearRect(0, 0, W0, H0);

      // Outer absorbing square + clipped Neumann obstacles.
      const o = toScreen(0, 1);
      kctx.lineWidth = 3;
      kctx.strokeStyle = theme.dirichlet;
      kctx.strokeRect(o[0], o[1], SQ, SQ);
      drawObstacles(kctx, localScene.rects);

      // The source x and the kernel histogram toggle together.
      if (!showKernel) return;

      // Poisson-kernel bars along the perimeter (same scheme as I3).
      const N = Math.max(1, totalSamples);
      const binWidthScene = 4 / NBINS;
      let maxD = 0;
      const dens = new Float32Array(NBINS);
      for (let b = 0; b < NBINS; b++) {
        dens[b] = (prob[b] / N) / binWidthScene;
        if (dens[b] > maxD) maxD = dens[b];
      }
      const targetMax = PAD - 10;
      const barScale = maxD > 0 ? targetMax / maxD : 0;
      const wPx = (4 * SQ / NBINS) * 0.95;
      const BAR_GAP = 2; // px the bar base sits outside the boundary stroke
      for (let b = 0; b < NBINS; b++) {
        const len = dens[b] * barScale;
        if (len < 0.5) continue;
        const sMid = (b + 0.5) / NBINS * 4;
        const [x, y, nx, ny] = perimeterToXY(sMid);
        const [px, py] = toScreen(x, y);
        const sNx = nx, sNy = -ny;
        const t = Math.min(1, dens[b] / Math.max(maxD, 1e-9));
        kctx.fillStyle = U.colormap(0.5 - 0.5 * t, theme);
        const tx = -sNy, ty = sNx, halfW = wPx * 0.5;
        const bx = px + sNx * BAR_GAP, by = py + sNy * BAR_GAP;
        kctx.beginPath();
        kctx.moveTo(bx - tx * halfW, by - ty * halfW);
        kctx.lineTo(bx + tx * halfW, by + ty * halfW);
        kctx.lineTo(bx + tx * halfW + sNx * len, by + ty * halfW + sNy * len);
        kctx.lineTo(bx - tx * halfW + sNx * len, by - ty * halfW + sNy * len);
        kctx.closePath();
        kctx.fill();
      }

      // Source point + its "x" label, drawn on the canvas (not an HTML
      // overlay) so it's captured when exporting video.
      const sp = toScreen(source.x, source.y);
      kctx.save();
      kctx.fillStyle = theme.walk;
      kctx.strokeStyle = theme.bg || '#fff';
      kctx.lineWidth = 1.8;
      kctx.beginPath();
      kctx.arc(sp[0], sp[1], 6, 0, Math.PI * 2);
      kctx.fill();
      kctx.stroke();
      kctx.restore();
      drawSourceX(sp[0] + 12, sp[1] - 10);
    }

    // In-canvas italic "x" beside the source, in KaTeX's math font with a
    // white halo (mirrors the HTML overlay used elsewhere, but rendered on
    // the canvas so the video capture includes it).
    function drawSourceX(cx, cy) {
      kctx.save();
      kctx.textBaseline = 'middle';
      kctx.textAlign = 'left';
      kctx.font = 'italic 20px KaTeX_Math, Georgia, "Times New Roman", serif';
      const x0 = cx - kctx.measureText('x').width / 2;
      kctx.fillStyle = theme.text;
      kctx.shadowColor = theme.surface;
      kctx.shadowBlur = 3;
      for (let k = 0; k < 3; k++) kctx.fillText('x', x0, cy);
      kctx.restore();
    }

    // ---- Interaction ------------------------------------------------
    function evToScene(canvasEl, e) {
      const r = canvasEl.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width * W0;
      const cy = (e.clientY - r.top) / r.height * H0;
      return [(cx - PAD) / SQ, 1 - (cy - PAD) / SQ];
    }

    // Left: click selects a tile.
    decompCanvas.addEventListener('pointerdown', (e) => {
      const [x, y] = evToScene(decompCanvas, e);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      sel = {
        i: Math.min(n - 1, Math.max(0, Math.floor(x * n))),
        j: Math.min(n - 1, Math.max(0, Math.floor(y * n))),
      };
      source.x = 0.5; source.y = 0.5; // reset to tile center
      rebuildLocalScene();
      drawDecomp();
    });

    // Right: click/drag moves the source point.
    let dragging = false;
    function setSourceFrom(e) {
      const [x, y] = evToScene(kernelCanvas, e);
      source.x = Math.max(0.02, Math.min(0.98, x));
      source.y = Math.max(0.02, Math.min(0.98, y));
      ensureSourceOutside();
      resetEstimate();
    }
    kernelCanvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { kernelCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      setSourceFrom(e);
    });
    kernelCanvas.addEventListener('pointermove', (e) => { if (dragging) setSourceFrom(e); });
    kernelCanvas.addEventListener('pointerup', () => { dragging = false; });
    kernelCanvas.addEventListener('pointercancel', () => { dragging = false; });

    if (tileSlider) {
      tileSlider.addEventListener('input', () => {
        n = parseInt(tileSlider.value);
        if (tileLabel) tileLabel.textContent = `${n}×${n}`;
        sel.i = Math.min(n - 1, sel.i);
        sel.j = Math.min(n - 1, sel.j);
        source.x = 0.5; source.y = 0.5;
        rebuildLocalScene();
        drawDecomp();
      });
    }
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        if (e.target && e.target.name) {
          solverMode = e.target.value;
          localScene.mode = solverMode;
          resetEstimate();
        }
      });
    }
    if (recomputeBtn) recomputeBtn.addEventListener('click', moreSamples);
    if (showKernelCb) {
      showKernelCb.addEventListener('change', () => { showKernel = showKernelCb.checked; });
    }

    // Studio-only: export either pane's boundaries as an SVG — the
    // selected subdomain (right) or the whole decomposition with the
    // selected tile highlighted (left). No kernel bars, no source x.
    if (document.body.classList.contains('studio')) {
      const parent = recomputeBtn ? recomputeBtn.parentNode : root;
      const mkBtn = (label, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.marginTop = '10px';
        b.addEventListener('click', fn);
        parent.appendChild(b);
      };
      mkBtn('Export subdomain SVG', exportSubdomainSVG);
      mkBtn('Export decomposition SVG', exportDecompSVG);
    }

    const ES = 340, EP = 6, EDIM = ES + 2 * EP; // fixed export size (matches I3)
    const emap = (x, y) => [EP + x * ES, EP + (1 - y) * ES];

    function svgPaint(col) {
      const m = /rgba?\(([^)]+)\)/.exec(col);
      if (m) {
        const p = m[1].split(',').map((s) => s.trim());
        return { color: `rgb(${p[0]},${p[1]},${p[2]})`,
                 opacity: p.length > 3 ? parseFloat(p[3]) : 1 };
      }
      return { color: col, opacity: 1 };
    }

    function svgOpen() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${EDIM}" ` +
        `height="${EDIM}" viewBox="0 0 ${EDIM} ${EDIM}">`;
    }
    function svgOuterSquare() {
      const dir = svgPaint(theme.dirichlet);
      return `<rect x="${EP}" y="${EP}" width="${ES}" height="${ES}" fill="none" ` +
        `stroke="${dir.color}" stroke-opacity="${dir.opacity}" stroke-width="3"/>`;
    }
    function svgObstacleRects(rects) {
      const fill = svgPaint(theme.neumannFill);
      const stroke = svgPaint(theme.neumann);
      return rects.map((r) => {
        const [x, y] = emap(r.x0, r.y1);
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
          `width="${((r.x1 - r.x0) * ES).toFixed(2)}" height="${((r.y1 - r.y0) * ES).toFixed(2)}" ` +
          `fill="${fill.color}" fill-opacity="${fill.opacity}" ` +
          `stroke="${stroke.color}" stroke-opacity="${stroke.opacity}" ` +
          `stroke-width="2" stroke-dasharray="5,4"/>`;
      });
    }
    function downloadSVG(parts, filename) {
      const blob = new Blob([parts.join('\n')], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function exportSubdomainSVG() {
      const out = [svgOpen(), svgOuterSquare(), ...svgObstacleRects(localScene.rects), '</svg>'];
      downloadSVG(out, `subdomain-${sel.i}-${sel.j}-of-${n}.svg`);
    }

    function exportDecompSVG() {
      // Decomposition only — no selected-tile overlay (added by hand on the
      // slide). Just the tile grid, outer Dirichlet square, and obstacles.
      const grid = svgPaint(theme.interface);
      const out = [svgOpen()];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const [vx0, vy0] = emap(t, 0), [vx1, vy1] = emap(t, 1);
        out.push(`<line x1="${vx0.toFixed(2)}" y1="${vy0.toFixed(2)}" x2="${vx1.toFixed(2)}" ` +
          `y2="${vy1.toFixed(2)}" stroke="${grid.color}" stroke-opacity="${grid.opacity}" stroke-width="1.5"/>`);
        const [hx0, hy0] = emap(0, t), [hx1, hy1] = emap(1, t);
        out.push(`<line x1="${hx0.toFixed(2)}" y1="${hy0.toFixed(2)}" x2="${hx1.toFixed(2)}" ` +
          `y2="${hy1.toFixed(2)}" stroke="${grid.color}" stroke-opacity="${grid.opacity}" stroke-width="1.5"/>`);
      }
      out.push(svgOuterSquare(), ...svgObstacleRects(baseScene.rects), '</svg>');
      downloadSVG(out, `decomposition-${n}x${n}.svg`);
    }

    if (tileLabel) tileLabel.textContent = `${n}×${n}`;
    rebuildLocalScene();
    U.animLoop(root, frame);
  }

  W.WoDS.interactiveSubdomainKernel = W.WoDS.lazyFigure(init);
})(window);
