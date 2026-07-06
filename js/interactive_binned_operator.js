/* Figure — precomputed binned solution operator of a chosen subdomain.
 *
 * Left pane: the decomposition (12-obstacle scene + n×n tile grid). Click
 * a tile to choose a subdomain. Right pane: that tile remapped to the unit
 * square, its interior split into an R×R grid of buckets. For each bucket
 * we precompute (short Monte-Carlo walks) the first-passage distribution
 * over the subdomain boundary, binned into R buckets per edge — interior
 * and boundary resolution match (one slider). Dragging x snaps to the
 * nearest valid bucket and shows that bucket's precomputed boundary
 * histogram: one row of the subdomain's discrete solution operator.
 * Buckets whose center is inside a (clipped) Neumann obstacle are skipped.
 *
 * Cost control: NOTHING is computed until the user clicks "Precompute" —
 * it would otherwise stall the rest of the studio. Precomputation is
 * chunked across frames with a progress bar and ETA. A persistent paint
 * loop redraws the (cheap) static geometry so both canvases survive
 * capture.js's resolution boost. */
(function (W) {
  const U = W.WoDS.util;
  const S = W.WoDS.solver;
  const Sc = W.WoDS.scenes;

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const decompCanvas = root.querySelector('canvas[data-role="decomp"]');
    const opCanvas = root.querySelector('canvas[data-role="operator"]');
    const tileSlider = root.querySelector('input[data-role="tiles"]');
    const tileLabel = root.querySelector('[data-role="tiles-label"]');
    const resSlider = root.querySelector('input[data-role="res"]');
    const resLabel = root.querySelector('[data-role="res-label"]');
    const sampSlider = root.querySelector('input[data-role="samples"]');
    const sampLabel = root.querySelector('[data-role="samples-label"]');
    const precomputeBtn = root.querySelector('button[data-role="precompute"]');
    const toggleGridBtn = root.querySelector('button[data-role="toggle-grid"]');
    const toggleKernelBtn = root.querySelector('button[data-role="toggle-kernel"]');
    const statusLabel = root.querySelector('[data-role="status"]');
    const progressBox = root.querySelector('[data-role="progress"]');
    const progressFill = root.querySelector('[data-role="progress-fill"]');
    const progressText = root.querySelector('[data-role="progress-text"]');
    const toggle = root.querySelector('[data-role="solver-toggle"]');

    const W0 = 360, H0 = 360, PAD = 56, SQ = W0 - 2 * PAD;
    const dctx = U.fitCanvas(decompCanvas, W0, H0);
    const opctx = U.fitCanvas(opCanvas, W0, H0);

    let solverMode = toggle ? toggle.querySelector('input:checked').value : 'wost';
    let n = parseInt(tileSlider.value);   // tiling resolution (subdomain pick)
    let R = parseInt(resSlider.value);     // binning resolution of the subdomain
    let Ssamp = parseInt(sampSlider.value);
    let showGrid = true;
    let gridReveal = 1;   // eased 0..1 reveal of the internal subgrid
    let lastT = null;
    // Toggles the source x, the kernel histogram, and the selected-cell
    // mask together (leaving just the subdomain geometry + subgrid).
    let showKernel = true;
    let selTile = { ti: Math.floor(n / 2), tj: Math.floor(n / 2) };

    const baseScene = Sc.layout(12);
    const localScene = {
      walls: [
        { x0: 0, y0: 1, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 1, y0: 0, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 1, y1: 0, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 0, y1: 1, kind: 'D', value: 0 },
      ],
      rects: [], circles: [], mode: solverMode,
    };

    const nb = () => 4 * R;
    const bucketIndex = (ix, iy) => iy * R + ix;
    const bucketCenter = (ix, iy) => [(ix + 0.5) / R, (iy + 0.5) / R];
    const toScreen = (x, y) => [PAD + x * SQ, PAD + (1 - y) * SQ];
    const tileBounds = () => ({ a: selTile.ti / n, b: selTile.tj / n, L: 1 / n });

    // Distinct color for the subdomain's internal binning grid so it reads
    // differently from the orange tile decomposition on the left.
    const subgridColor = theme.subgrid || '#3a9e8c';
    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
    function approach(cur, target, rate) {
      if (cur < target) return Math.min(target, cur + rate);
      if (cur > target) return Math.max(target, cur - rate);
      return cur;
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
      computeValidBuckets();
      selBucket = snap(0.5, 0.5);
    }

    function pointInObstacle(x, y) {
      for (const r of localScene.rects) {
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
      }
      return false;
    }

    let validBuckets = [];
    function computeValidBuckets() {
      validBuckets = [];
      for (let iy = 0; iy < R; iy++) {
        for (let ix = 0; ix < R; ix++) {
          const c = bucketCenter(ix, iy);
          if (!pointInObstacle(c[0], c[1])) validBuckets.push({ ix, iy });
        }
      }
    }

    function snap(x, y) {
      let best = validBuckets[0] || { ix: 0, iy: 0 }, bestD = Infinity;
      for (const b of validBuckets) {
        const c = bucketCenter(b.ix, b.iy);
        const d = (c[0] - x) * (c[0] - x) + (c[1] - y) * (c[1] - y);
        if (d < bestD) { bestD = d; best = b; }
      }
      return best;
    }

    let selBucket = { ix: 0, iy: 0 };

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

    // ---- Precomputation ---------------------------------------------
    let H = null;
    let computedKey = '';   // identifies the (tile,R,S,solver) H is valid for
    let computing = false;
    let pcList = [], pcI = 0, pcSample = 0, pcStart = 0;

    const stateKey = () => `${selTile.ti},${selTile.tj}|${n}|${R}|${Ssamp}|${solverMode}`;

    function invalidate(msg) {
      computing = false;
      H = null;
      computedKey = '';
      if (precomputeBtn) precomputeBtn.disabled = false;
      if (progressBox) progressBox.style.display = 'none';
      if (statusLabel) {
        statusLabel.textContent = msg || 'Pick a subdomain, then click “Precompute”.';
      }
    }

    function startPrecompute() {
      H = new Array(R * R);
      pcList = validBuckets.slice();
      for (const b of pcList) H[bucketIndex(b.ix, b.iy)] = new Float32Array(nb());
      pcI = 0; pcSample = 0; pcStart = performance.now();
      computedKey = stateKey();
      computing = pcList.length > 0;
      if (precomputeBtn) precomputeBtn.disabled = true;
      if (progressBox) progressBox.style.display = 'block';
    }

    function stepPrecompute() {
      const NBb = nb(), total = pcList.length;
      const t0 = performance.now();
      let count = 0;
      while (computing) {
        const b = pcList[pcI];
        const c = bucketCenter(b.ix, b.iy);
        const hist = H[bucketIndex(b.ix, b.iy)];
        const r = S.walk(localScene, c[0], c[1], false);
        if (r.kind === 'D') {
          const s = paramOnPerimeter(r.endX, r.endY);
          const k = Math.min(NBb - 1, Math.max(0, Math.floor(s / 4 * NBb)));
          hist[k] += 1;
        }
        pcSample++;
        if (pcSample >= Ssamp) {
          pcI++; pcSample = 0;
          if (pcI >= total) computing = false;
        }
        if ((++count & 255) === 0 && performance.now() - t0 > 22) break;
      }

      const workDone = pcI * Ssamp + pcSample;
      const workTotal = total * Ssamp;
      const frac = workTotal > 0 ? Math.min(1, workDone / workTotal) : 1;
      const elapsed = (performance.now() - pcStart) / 1000;
      if (progressFill) progressFill.style.width = (frac * 100).toFixed(1) + '%';
      if (computing) {
        const eta = frac > 0.02 ? `~${(elapsed * (1 - frac) / frac).toFixed(1)}s left` : 'estimating…';
        if (progressText) progressText.textContent = `Precomputing… ${(frac * 100).toFixed(0)}% · ${eta}`;
      } else {
        if (progressText) {
          progressText.textContent = `Done · ${pcList.length} buckets · ${Ssamp} samples each`;
        }
        if (statusLabel) statusLabel.textContent = 'Operator ready — drag x to inspect buckets.';
        if (precomputeBtn) precomputeBtn.disabled = false;
      }
    }

    const ready = () => H && computedKey === stateKey() && !computing;

    // ---- Rendering --------------------------------------------------
    function drawObstacles(ctx, rects) {
      ctx.save();
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const r of rects) {
        const tl = toScreen(r.x0, r.y1);
        ctx.fillRect(tl[0], tl[1], (r.x1 - r.x0) * SQ, (r.y1 - r.y0) * SQ);
        ctx.strokeRect(tl[0], tl[1], (r.x1 - r.x0) * SQ, (r.y1 - r.y0) * SQ);
      }
      ctx.restore();
    }

    function gridLines(ctx, m) {
      for (let i = 1; i < m; i++) {
        const t = i / m;
        let p0 = toScreen(t, 0), p1 = toScreen(t, 1);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        p0 = toScreen(0, t); p1 = toScreen(1, t);
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
    }

    function drawDecomp() {
      dctx.clearRect(0, 0, W0, H0);
      const { a, b, L } = tileBounds();
      const tl = toScreen(a, b + L);

      dctx.fillStyle = 'rgba(58,96,156,0.12)';
      dctx.fillRect(tl[0], tl[1], L * SQ, L * SQ);

      dctx.save();
      dctx.strokeStyle = theme.interface;
      dctx.lineWidth = 1.5;
      gridLines(dctx, n);
      dctx.restore();

      const o = toScreen(0, 1);
      dctx.lineWidth = 3;
      dctx.strokeStyle = theme.dirichlet;
      dctx.strokeRect(o[0], o[1], SQ, SQ);
      drawObstacles(dctx, baseScene.rects);

      dctx.lineWidth = 2.5;
      dctx.strokeStyle = theme.accent;
      dctx.strokeRect(tl[0], tl[1], L * SQ, L * SQ);
    }

    function drawBars() {
      const hist = H[bucketIndex(selBucket.ix, selBucket.iy)];
      if (!hist) return;
      const NBb = nb();
      const binWidthScene = 4 / NBb;
      let sum = 0;
      for (let k = 0; k < NBb; k++) sum += hist[k];
      const Nnorm = Math.max(1, sum);
      let maxD = 0;
      const dens = new Float32Array(NBb);
      for (let k = 0; k < NBb; k++) {
        dens[k] = (hist[k] / Nnorm) / binWidthScene;
        if (dens[k] > maxD) maxD = dens[k];
      }
      const targetMax = PAD - 10;
      const barScale = maxD > 0 ? targetMax / maxD : 0;
      const wPx = (SQ / R) * 0.9;
      const BAR_GAP = 2;
      for (let k = 0; k < NBb; k++) {
        const len = dens[k] * barScale;
        if (len < 0.5) continue;
        const sMid = (k + 0.5) / NBb * 4;
        const [x, y, nx, ny] = perimeterToXY(sMid);
        const [px, py] = toScreen(x, y);
        const sNx = nx, sNy = -ny;
        const t = Math.min(1, dens[k] / Math.max(maxD, 1e-9));
        opctx.fillStyle = U.colormap(0.5 - 0.5 * t, theme);
        const tx = -sNy, ty = sNx, halfW = wPx * 0.5;
        const bx = px + sNx * BAR_GAP, by = py + sNy * BAR_GAP;
        opctx.beginPath();
        opctx.moveTo(bx - tx * halfW, by - ty * halfW);
        opctx.lineTo(bx + tx * halfW, by + ty * halfW);
        opctx.lineTo(bx + tx * halfW + sNx * len, by + ty * halfW + sNy * len);
        opctx.lineTo(bx - tx * halfW + sNx * len, by - ty * halfW + sNy * len);
        opctx.closePath();
        opctx.fill();
      }
    }

    function drawSourceX(cx, cy) {
      opctx.save();
      opctx.textBaseline = 'middle';
      opctx.textAlign = 'left';
      opctx.font = 'italic 20px KaTeX_Math, Georgia, "Times New Roman", serif';
      const x0 = cx - opctx.measureText('x').width / 2;
      opctx.fillStyle = theme.text;
      opctx.shadowColor = theme.surface;
      opctx.shadowBlur = 3;
      for (let k = 0; k < 3; k++) opctx.fillText('x', x0, cy);
      opctx.restore();
    }

    // Internal binning grid, revealed/hidden with an eased cascade that
    // marches outward from the center (same animation as the pipeline
    // figure): each line fades in and grows from its midpoint, staggered.
    function drawSubgrid() {
      if (gridReveal <= 0.001) return;
      const segs = [];
      for (let i = 1; i < R; i++) {
        const t = i / R;
        segs.push([t, 0, t, 1]);
        segs.push([0, t, 1, t]);
      }
      opctx.save();
      opctx.strokeStyle = subgridColor;
      opctx.lineWidth = 1;
      const m = segs.length;
      const STAGGER = 0.5;
      for (let k = 0; k < m; k++) {
        const s = segs[k];
        const delay = m > 1 ? STAGGER * (k / (m - 1)) : 0;
        const span = 1 - STAGGER;
        let p = (gridReveal - delay) / (span || 1);
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        const e = easeOut(p);
        if (e <= 0.001) continue;
        const A = toScreen(s[0], s[1]), B = toScreen(s[2], s[3]);
        const cx = (A[0] + B[0]) / 2, cy = (A[1] + B[1]) / 2;
        opctx.globalAlpha = 0.7 * e;
        opctx.beginPath();
        opctx.moveTo(cx + (A[0] - cx) * e, cy + (A[1] - cy) * e);
        opctx.lineTo(cx + (B[0] - cx) * e, cy + (B[1] - cy) * e);
        opctx.stroke();
      }
      opctx.restore();
    }

    function drawOperator() {
      opctx.clearRect(0, 0, W0, H0);

      // Selected-cell mask (toggles with the source/kernel).
      if (showKernel) {
        const cw = SQ / R;
        const [hx, hy] = toScreen(selBucket.ix / R, (selBucket.iy + 1) / R);
        opctx.fillStyle = 'rgba(58,96,156,0.12)';
        opctx.fillRect(hx, hy, cw, cw);
      }

      drawSubgrid();

      const o = toScreen(0, 1);
      opctx.lineWidth = 3;
      opctx.strokeStyle = theme.dirichlet;
      opctx.strokeRect(o[0], o[1], SQ, SQ);
      drawObstacles(opctx, localScene.rects);

      if (!showKernel) return;

      if (ready()) drawBars();

      const c = bucketCenter(selBucket.ix, selBucket.iy);
      const sp = toScreen(c[0], c[1]);
      opctx.save();
      opctx.fillStyle = theme.walk;
      opctx.strokeStyle = theme.bg || '#fff';
      opctx.lineWidth = 1.8;
      opctx.beginPath();
      opctx.arc(sp[0], sp[1], 6, 0, Math.PI * 2);
      opctx.fill();
      opctx.stroke();
      opctx.restore();
      drawSourceX(sp[0] + 12, sp[1] - 10);
    }

    function frame(t) {
      const dt = lastT == null ? 0 : t - lastT;
      lastT = t;
      gridReveal = approach(gridReveal, showGrid ? 1 : 0, dt / 600);
      if (computing) stepPrecompute();
      drawDecomp();
      drawOperator();
    }

    // ---- Interaction ------------------------------------------------
    function evToScene(canvasEl, e) {
      const r = canvasEl.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width * W0;
      const cy = (e.clientY - r.top) / r.height * H0;
      return [(cx - PAD) / SQ, 1 - (cy - PAD) / SQ];
    }

    // Left: choose a subdomain tile.
    decompCanvas.addEventListener('pointerdown', (e) => {
      const [x, y] = evToScene(decompCanvas, e);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      selTile = {
        ti: Math.min(n - 1, Math.max(0, Math.floor(x * n))),
        tj: Math.min(n - 1, Math.max(0, Math.floor(y * n))),
      };
      rebuildLocalScene();
      invalidate('Subdomain changed — click “Precompute”.');
    });

    // Right: drag x, snapping to the nearest valid bucket.
    let dragging = false;
    opCanvas.addEventListener('pointerdown', (e) => {
      const [x, y] = evToScene(opCanvas, e);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      dragging = true;
      try { opCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      selBucket = snap(x, y);
    });
    opCanvas.addEventListener('pointermove', (e) => { if (dragging) selBucket = snap(...evToScene(opCanvas, e)); });
    opCanvas.addEventListener('pointerup', () => { dragging = false; });
    opCanvas.addEventListener('pointercancel', () => { dragging = false; });

    if (tileSlider) {
      tileSlider.addEventListener('input', () => {
        n = parseInt(tileSlider.value);
        if (tileLabel) tileLabel.textContent = `${n}×${n}`;
        selTile.ti = Math.min(n - 1, selTile.ti);
        selTile.tj = Math.min(n - 1, selTile.tj);
        rebuildLocalScene();
        invalidate('Subdomain changed — click “Precompute”.');
      });
    }
    if (resSlider) {
      resSlider.addEventListener('input', () => {
        R = parseInt(resSlider.value);
        if (resLabel) resLabel.textContent = `${R}×${R}`;
        computeValidBuckets();
        selBucket = snap(0.5, 0.5);
        invalidate('Resolution changed — click “Precompute”.');
      });
    }
    if (sampSlider) {
      sampSlider.addEventListener('input', () => {
        Ssamp = parseInt(sampSlider.value);
        if (sampLabel) sampLabel.textContent = `${Ssamp}`;
        invalidate('Sample count changed — click “Precompute”.');
      });
    }
    if (toggleGridBtn) {
      const updateGridBtn = () => {
        toggleGridBtn.textContent = showGrid ? 'Hide subgrid' : 'Show subgrid';
      };
      toggleGridBtn.addEventListener('click', () => { showGrid = !showGrid; updateGridBtn(); });
      updateGridBtn();
    }
    if (toggleKernelBtn) {
      const updateKernelBtn = () => {
        toggleKernelBtn.textContent = showKernel ? 'Hide source & kernel' : 'Show source & kernel';
      };
      toggleKernelBtn.addEventListener('click', () => { showKernel = !showKernel; updateKernelBtn(); });
      updateKernelBtn();
    }
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        if (e.target && e.target.name) {
          solverMode = e.target.value;
          localScene.mode = solverMode;
          invalidate('Solver changed — click “Precompute”.');
        }
      });
    }
    if (precomputeBtn) precomputeBtn.addEventListener('click', startPrecompute);

    if (tileLabel) tileLabel.textContent = `${n}×${n}`;
    if (resLabel) resLabel.textContent = `${R}×${R}`;
    if (sampLabel) sampLabel.textContent = `${Ssamp}`;
    rebuildLocalScene();
    invalidate();
    U.animLoop(root, frame);
  }

  W.WoDS.interactiveBinnedOperator = W.WoDS.lazyFigure(init);
})(window);
