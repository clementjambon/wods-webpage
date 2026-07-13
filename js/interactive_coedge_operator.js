/* Figure — precomputed binned solution operator of a co-edge subdomain.
 *
 * Sibling of #binop, but the subdomain is a *co-edge* subdomain: the union
 * of the two tiles that share an interface (a 2×1 or 1×2 rectangle, like
 * the slides). Left pane: the decomposition (12-obstacle scene + n×n tile
 * grid); click near an interface to pick the co-edge around it. Right pane:
 * that co-edge drawn at its true 2:1 aspect, its outer edges absorbing
 * Dirichlet exits, clipped obstacles Neumann.
 *
 * Unlike #binop, only the *interface* is discretized — the source x lives on
 * the shared edge, split into R stations. For each station we precompute
 * (short Monte-Carlo walks) the first-passage distribution over the co-edge
 * boundary, binned into R buckets per edge. Dragging the dot snaps to the
 * nearest station and shows that station's precomputed boundary histogram:
 * one row of the co-edge's discrete solution operator. The source is shown
 * as just a dot (no "x" label).
 *
 * Cost control: NOTHING is computed until the user clicks "Precompute".
 * Precomputation is chunked across frames with a progress bar and ETA. */
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
    const lineWidthSlider = root.querySelector('input[data-role="line-width"]');
    const lineWidthLabel = root.querySelector('[data-role="line-width-label"]');
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
    let n = parseInt(tileSlider.value);   // tiling resolution (co-edge pick)
    let R = parseInt(resSlider.value);     // interface stations = boundary bins/edge
    let Ssamp = parseInt(sampSlider.value);
    let showGrid = true;                   // show the discretized interface
    let ifaceWidth = lineWidthSlider ? parseFloat(lineWidthSlider.value) : 1;
    let gridReveal = 1;   // eased 0..1 reveal of the interface discretization
    let lastT = null;
    let showKernel = true; // source dot + kernel histogram together

    const baseScene = Sc.layout(12);

    // ---- Co-edge selection ------------------------------------------
    // A co-edge is 'wide' (2 tiles side-by-side, vertical interface) or
    // 'tall' (2 tiles stacked, horizontal interface). We store its world
    // rect (global unit-square coords) and derive local coords where each
    // tile is one unit: local domain is [0,Wd]×[0,Hd], (Wd,Hd)=(2,1)/(1,2),
    // interface along the centerline (x=1 wide / y=1 tall).
    let sel = null;  // { wide, world:{x0,y0,x1,y1} }
    let Wd = 2, Hd = 1, scale = SQ / 2, ox = 0, oy = 0;

    function makeSel(wide, idx, k) {
      const L = 1 / n;
      if (wide) {
        return { wide: true, world: { x0: (idx - 1) * L, x1: (idx + 1) * L, y0: k * L, y1: (k + 1) * L } };
      }
      return { wide: false, world: { x0: k * L, x1: (k + 1) * L, y0: (idx - 1) * L, y1: (idx + 1) * L } };
    }

    // Snap a click on the left pane to the nearest interior interface and
    // return the co-edge around it (mirrors #coedge-fig's pickInterface).
    function pickCoedge(cx, cy) {
      const iv = Math.round(cx * n), ih = Math.round(cy * n);
      if (Math.abs(cx - iv / n) <= Math.abs(cy - ih / n)) {
        const idx = Math.min(n - 1, Math.max(1, iv));
        const row = Math.min(n - 1, Math.max(0, Math.floor(cy * n)));
        return makeSel(true, idx, row);
      }
      const idx = Math.min(n - 1, Math.max(1, ih));
      const col = Math.min(n - 1, Math.max(0, Math.floor(cx * n)));
      return makeSel(false, idx, col);
    }

    // Local (co-edge) scene fed to the solver: all outer edges absorbing,
    // clipped obstacles Neumann.
    const localScene = { walls: [], rects: [], circles: [], mode: solverMode };

    // Global -> screen (left pane): plain unit-square map.
    const toScreenG = (x, y) => [PAD + x * SQ, PAD + (1 - y) * SQ];
    // Local -> screen (right pane): centered, true aspect.
    const toScreen = (x, y) => [ox + x * scale, oy + (Hd - y) * scale];

    // Interface stations in local coords.
    const nStations = () => R;
    function localStation(i) {
      return sel.wide ? [1, (i + 0.5) / R] : [(i + 0.5) / R, 1];
    }

    // Boundary bins with uniform arc-length width: each edge gets one bin
    // per tile-length of R, so the long edges (Wd or Hd = 2 tiles) carry
    // twice as many bins as the short ones — all bins end up the same width.
    const edgeLenTiles = (edge) => (edge % 2 === 0) ? Wd : Hd; // bottom/top=Wd, right/left=Hd
    const edgeBinCount = (edge) => edgeLenTiles(edge) * R;
    const edgeOffset = (edge) => {
      let o = 0;
      for (let e = 0; e < edge; e++) o += edgeBinCount(e);
      return o;
    };
    const nb = () => 2 * (Wd + Hd) * R;
    const histBin = (x, y) => {
      const s = paramOnPerimeter(x, y);
      const edge = Math.min(3, Math.max(0, Math.floor(s)));
      const cnt = edgeBinCount(edge);
      const bie = Math.min(cnt - 1, Math.max(0, Math.floor((s - edge) * cnt)));
      return edgeOffset(edge) + bie;
    };

    function rebuildLocalScene() {
      Wd = sel.wide ? 2 : 1;
      Hd = sel.wide ? 1 : 2;
      scale = SQ / Math.max(Wd, Hd);
      ox = (W0 - Wd * scale) / 2;
      oy = (H0 - Hd * scale) / 2;
      const L = 1 / n;
      const { world } = sel;
      const rects = [];
      for (const r of baseScene.rects) {
        const x0 = Math.max(r.x0, world.x0), x1 = Math.min(r.x1, world.x1);
        const y0 = Math.max(r.y0, world.y0), y1 = Math.min(r.y1, world.y1);
        if (x1 - x0 > 1e-4 && y1 - y0 > 1e-4) {
          rects.push({
            x0: (x0 - world.x0) / L, y0: (y0 - world.y0) / L,
            x1: (x1 - world.x0) / L, y1: (y1 - world.y0) / L, kind: 'N',
          });
        }
      }
      localScene.rects = rects;
      localScene.walls = [
        { x0: 0, y0: Hd, x1: Wd, y1: Hd, kind: 'D', value: 0 },
        { x0: Wd, y0: 0, x1: Wd, y1: Hd, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: Wd, y1: 0, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 0, y1: Hd, kind: 'D', value: 0 },
      ];
      localScene.mode = solverMode;
      computeValid();
      selI = snap(...localStation(Math.floor(R / 2)));
    }

    function pointInObstacle(x, y) {
      for (const r of localScene.rects) {
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
      }
      return false;
    }

    // Interface stations whose point is not swallowed by an obstacle.
    let validI = [];
    function computeValid() {
      validI = [];
      for (let i = 0; i < R; i++) {
        const p = localStation(i);
        if (!pointInObstacle(p[0], p[1])) validI.push(i);
      }
    }

    function snap(x, y) {
      let best = validI.length ? validI[0] : 0, bestD = Infinity;
      for (const i of validI) {
        const p = localStation(i);
        const d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    let selI = 0;

    // Perimeter parametrization of [0,Wd]×[0,Hd] in s∈[0,4): one unit per
    // edge (bottom, right, top, left), fractional within the edge.
    function paramOnPerimeter(x, y) {
      const dB = Math.abs(y - 0), dR = Math.abs(x - Wd);
      const dT = Math.abs(y - Hd), dL = Math.abs(x - 0);
      const m = Math.min(dB, dR, dT, dL);
      const cx = Math.min(1, Math.max(0, x / Wd));
      const cy = Math.min(1, Math.max(0, y / Hd));
      if (m === dB) return 0 + cx;
      if (m === dR) return 1 + cy;
      if (m === dT) return 2 + (1 - cx);
      return 3 + (1 - cy);
    }
    function perimeterToXY(s) {
      s = ((s % 4) + 4) % 4;
      if (s < 1) return [s * Wd, 0, 0, -1];
      if (s < 2) return [Wd, (s - 1) * Hd, 1, 0];
      if (s < 3) return [(3 - s) * Wd, Hd, 0, 1];
      return [0, (4 - s) * Hd, -1, 0];
    }

    // ---- Precomputation ---------------------------------------------
    let H = null;
    let computedKey = '';
    let computing = false;
    let pcList = [], pcI = 0, pcSample = 0, pcStart = 0;

    const stateKey = () => {
      const w = sel.world;
      return `${w.x0.toFixed(4)},${w.y0.toFixed(4)},${sel.wide}|${n}|${R}|${Ssamp}|${solverMode}`;
    };

    function invalidate(msg) {
      computing = false;
      H = null;
      computedKey = '';
      if (precomputeBtn) precomputeBtn.disabled = false;
      if (progressBox) progressBox.style.display = 'none';
      if (statusLabel) {
        statusLabel.textContent = msg || 'Pick a co-edge subdomain, then click “Precompute”.';
      }
    }

    function startPrecompute() {
      H = new Array(R);
      pcList = validI.slice();
      for (const i of pcList) H[i] = new Float32Array(nb());
      pcI = 0; pcSample = 0; pcStart = performance.now();
      computedKey = stateKey();
      computing = pcList.length > 0;
      if (precomputeBtn) precomputeBtn.disabled = true;
      if (progressBox) progressBox.style.display = 'block';
    }

    function stepPrecompute() {
      const total = pcList.length;
      const t0 = performance.now();
      let count = 0;
      while (computing) {
        const i = pcList[pcI];
        const c = localStation(i);
        const hist = H[i];
        const r = S.walk(localScene, c[0], c[1], false);
        if (r.kind === 'D') {
          hist[histBin(r.endX, r.endY)] += 1;
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
          progressText.textContent = `Done · ${pcList.length} stations · ${Ssamp} samples each`;
        }
        if (statusLabel) statusLabel.textContent = 'Operator ready — drag the dot along the interface.';
        if (precomputeBtn) precomputeBtn.disabled = false;
      }
    }

    const ready = () => H && computedKey === stateKey() && !computing;

    // ---- Rendering --------------------------------------------------
    function drawObstacles(ctx, rects, mapFn) {
      ctx.save();
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const r of rects) {
        const tl = mapFn(r.x0, r.y1);
        const br = mapFn(r.x1, r.y0);
        ctx.fillRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
        ctx.strokeRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
      }
      ctx.restore();
    }

    function drawDecomp() {
      dctx.clearRect(0, 0, W0, H0);

      // Co-edge highlight fill.
      if (sel) {
        const w = sel.world;
        const tl = toScreenG(w.x0, w.y1);
        const br = toScreenG(w.x1, w.y0);
        dctx.fillStyle = 'rgba(58,96,156,0.12)';
        dctx.fillRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
      }

      // Tile grid.
      dctx.save();
      dctx.strokeStyle = theme.interface;
      dctx.lineWidth = 1.5;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        let p0 = toScreenG(t, 0), p1 = toScreenG(t, 1);
        dctx.beginPath(); dctx.moveTo(p0[0], p0[1]); dctx.lineTo(p1[0], p1[1]); dctx.stroke();
        p0 = toScreenG(0, t); p1 = toScreenG(1, t);
        dctx.beginPath(); dctx.moveTo(p0[0], p0[1]); dctx.lineTo(p1[0], p1[1]); dctx.stroke();
      }
      dctx.restore();

      const o = toScreenG(0, 1);
      dctx.lineWidth = 3;
      dctx.strokeStyle = theme.dirichlet;
      dctx.strokeRect(o[0], o[1], SQ, SQ);
      drawObstacles(dctx, baseScene.rects, toScreenG);

      if (sel) {
        const w = sel.world;
        const tl = toScreenG(w.x0, w.y1);
        const br = toScreenG(w.x1, w.y0);
        dctx.lineWidth = 2.5;
        dctx.strokeStyle = theme.accent;
        dctx.strokeRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);

        // Shared interface emphasized.
        let a, b;
        if (sel.wide) {
          const xm = (w.x0 + w.x1) / 2;
          a = toScreenG(xm, w.y0); b = toScreenG(xm, w.y1);
        } else {
          const ym = (w.y0 + w.y1) / 2;
          a = toScreenG(w.x0, ym); b = toScreenG(w.x1, ym);
        }
        dctx.save();
        dctx.strokeStyle = theme.accent;
        dctx.lineWidth = 2.5;
        dctx.beginPath(); dctx.moveTo(a[0], a[1]); dctx.lineTo(b[0], b[1]); dctx.stroke();
        dctx.restore();
      }
    }

    function drawBars() {
      const hist = H[selI];
      if (!hist) return;
      const NB = nb();
      let sum = 0;
      for (let k = 0; k < NB; k++) sum += hist[k];
      const Nnorm = Math.max(1, sum);
      // All bins share the same arc-length width, so the raw normalized
      // count is already a comparable density.
      let maxD = 0;
      const dens = new Float32Array(NB);
      for (let k = 0; k < NB; k++) {
        dens[k] = hist[k] / Nnorm;
        if (dens[k] > maxD) maxD = dens[k];
      }
      const targetMax = PAD - 10;
      const barScale = maxD > 0 ? targetMax / maxD : 0;
      const BAR_GAP = 2;
      const wPx = (scale / R) * 0.9;       // one tile-bin wide, same on every edge
      for (let edge = 0; edge < 4; edge++) {
        const cnt = edgeBinCount(edge), off = edgeOffset(edge);
        for (let bie = 0; bie < cnt; bie++) {
          const k = off + bie;
          const len = dens[k] * barScale;
          if (len < 0.5) continue;
          const s = edge + (bie + 0.5) / cnt;
          const [x, y, nx, ny] = perimeterToXY(s);
          const [px, py] = toScreen(x, y);
          const sNx = nx, sNy = -ny;        // screen-space outward normal
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
    }

    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
    function approach(cur, target, rate) {
      if (cur < target) return Math.min(target, cur + rate);
      if (cur > target) return Math.max(target, cur - rate);
      return cur;
    }

    // The discretized interface: the centerline drawn in the *global*
    // interface color and thickness (matching the decomposition on the
    // left), with a small discretization-colored station dot at each of the
    // R sample points. Revealed with an eased grow-in.
    const DISC_COLOR = theme.subgrid || '#3a9e8c';   // discretization color
    const STATION_R = 3;
    function drawInterface() {
      if (gridReveal <= 0.001) return;
      const [ax, ay] = sel.wide ? [1, 0] : [0, 1];
      const [bx, by] = sel.wide ? [1, Hd] : [Wd, 1];
      const A = toScreen(ax, ay), B = toScreen(bx, by);
      const cx = (A[0] + B[0]) / 2, cy = (A[1] + B[1]) / 2;
      const e = easeOut(Math.min(1, gridReveal));
      opctx.save();
      // Interface line — same color and thickness as the tile interfaces
      // on the left (ifaceWidth defaults to the left column's 1.5).
      opctx.strokeStyle = theme.interface;
      opctx.lineWidth = ifaceWidth;
      opctx.globalAlpha = e;
      opctx.beginPath();
      opctx.moveTo(cx + (A[0] - cx) * e, cy + (A[1] - cy) * e);
      opctx.lineTo(cx + (B[0] - cx) * e, cy + (B[1] - cy) * e);
      opctx.stroke();
      // Station dots (discretization color, no ring).
      opctx.fillStyle = DISC_COLOR;
      for (const i of validI) {
        const p = localStation(i);
        const sp = toScreen(p[0], p[1]);
        opctx.globalAlpha = 0.9 * e;
        opctx.beginPath();
        opctx.arc(sp[0], sp[1], STATION_R, 0, Math.PI * 2);
        opctx.fill();
      }
      opctx.restore();
    }

    function drawOperator() {
      opctx.clearRect(0, 0, W0, H0);
      if (!sel) return;

      drawInterface();

      // Outer absorbing boundary + clipped Neumann obstacles.
      const tl = toScreen(0, Hd), br = toScreen(Wd, 0);
      opctx.lineWidth = 3;
      opctx.strokeStyle = theme.dirichlet;
      opctx.strokeRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
      drawObstacles(opctx, localScene.rects, toScreen);

      if (!showKernel) return;

      if (ready()) drawBars();

      // Source dot on the selected interface station (no "x" label).
      const c = localStation(selI);
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
    // Left pane uses the global unit-square map; right pane the local map.
    function evToGlobal(canvasEl, e) {
      const r = canvasEl.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width * W0;
      const cy = (e.clientY - r.top) / r.height * H0;
      return [(cx - PAD) / SQ, 1 - (cy - PAD) / SQ];
    }
    function evToLocal(canvasEl, e) {
      const r = canvasEl.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width * W0;
      const cy = (e.clientY - r.top) / r.height * H0;
      return [(cx - ox) / scale, Hd - (cy - oy) / scale];
    }

    // Left: click near an interface to pick its co-edge.
    decompCanvas.addEventListener('pointerdown', (e) => {
      const [x, y] = evToGlobal(decompCanvas, e);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      sel = pickCoedge(x, y);
      rebuildLocalScene();
      invalidate('Co-edge changed — click “Precompute”.');
    });

    // Right: drag the source, snapping to the nearest interface station.
    let dragging = false;
    opCanvas.addEventListener('pointerdown', (e) => {
      if (!sel) return;
      const [x, y] = evToLocal(opCanvas, e);
      dragging = true;
      try { opCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      selI = snap(x, y);
    });
    opCanvas.addEventListener('pointermove', (e) => { if (dragging) selI = snap(...evToLocal(opCanvas, e)); });
    opCanvas.addEventListener('pointerup', () => { dragging = false; });
    opCanvas.addEventListener('pointercancel', () => { dragging = false; });

    if (tileSlider) {
      tileSlider.addEventListener('input', () => {
        n = parseInt(tileSlider.value);
        if (tileLabel) tileLabel.textContent = `${n}×${n}`;
        sel = pickCoedge((sel.world.x0 + sel.world.x1) / 2, (sel.world.y0 + sel.world.y1) / 2);
        rebuildLocalScene();
        invalidate('Co-edge changed — click “Precompute”.');
      });
    }
    if (resSlider) {
      resSlider.addEventListener('input', () => {
        R = parseInt(resSlider.value);
        if (resLabel) resLabel.textContent = `${R}`;
        computeValid();
        selI = snap(...localStation(Math.floor(R / 2)));
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
    if (lineWidthSlider) {
      lineWidthSlider.addEventListener('input', () => {
        ifaceWidth = parseFloat(lineWidthSlider.value);
        if (lineWidthLabel) lineWidthLabel.textContent = ifaceWidth.toFixed(1);
      });
    }
    if (toggleGridBtn) {
      const updateGridBtn = () => {
        toggleGridBtn.textContent = showGrid ? 'Hide interface' : 'Show interface';
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
    if (resLabel) resLabel.textContent = `${R}`;
    if (sampLabel) sampLabel.textContent = `${Ssamp}`;
    if (lineWidthLabel) lineWidthLabel.textContent = ifaceWidth.toFixed(1);
    // Default: a central vertical interface (wide co-edge).
    sel = makeSel(true, Math.max(1, Math.round(n / 2)), Math.floor(n / 2));
    rebuildLocalScene();
    invalidate();
    U.animLoop(root, frame);
  }

  W.WoDS.interactiveCoedgeOperator = W.WoDS.lazyFigure(init);
})(window);
