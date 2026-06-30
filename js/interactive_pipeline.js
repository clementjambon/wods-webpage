/* Interactive — full WoDS pipeline.
 *
 * Same geometric setup as the mixed-problem demo: outer Dirichlet
 * square + interior Neumann obstacle. Boundary values are fixed
 * (top hot, bottom cold) — no painting.
 *
 * A 5-position slider reveals the WoDS pipeline:
 *   0. Domain only (outer ∂Ω_D + Neumann obstacle)
 *   1. + Tile interfaces (T×T regular tiling)
 *   2. + Local Monte Carlo walks within tiles
 *   3. + Solved interface collocation values (B per edge)
 *   4. + Reconstructed interior values (B×B per tile)
 *
 * Stages 3 & 4 cheat: values come from the in-browser FD solver
 * on the N×N grid (N = T×B). Collocation points falling inside a
 * Neumann obstacle are masked.
 */
(function (W) {
  const U = W.WoDS.util;
  const L = W.WoDS.laplace;
  const S = W.WoDS.solver;

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const size = 380;
    const canvas = root.querySelector('canvas.diagram');
    const ctx = U.fitCanvas(canvas, size, size);

    const stageSlider = root.querySelector('input[data-role="stage"]');
    const stageLabel = root.querySelector('[data-role="stage-label"]');
    const stageDesc = root.querySelector('[data-role="stage-desc"]');
    const tilesSlider = root.querySelector('input[data-role="tiles"]');
    const tilesLabel = root.querySelector('[data-role="tiles-label"]');
    const subSlider = root.querySelector('input[data-role="sub"]');
    const subLabel = root.querySelector('[data-role="sub-label"]');
    const resLabel = root.querySelector('[data-role="res-label"]');
    const scenePresetsDiv = root.querySelector('[data-role="scene-presets"]');
    const presetsDiv = root.querySelector('[data-role="presets"]');

    const STAGE_NAMES = [
      '0 — Domain',
      '1 — Decomposition',
      '2 — Local walks',
      '3 — Interface solve',
      '4 — Interior reconstruction',
    ];
    const STAGE_DESCRIPTIONS = [
      ['Domain.', 'Outer Dirichlet boundary (red) and Neumann obstacles (dashed blue) define the geometry.'],
      ['Decomposition.', 'Decompose Ω into a regular T×T grid. Tile interfaces (orange) become absorbing for the local random walks.'],
      ['Local walks.', 'Within each tile, short Walk-on-Stars trajectories estimate first-passage probabilities to the surrounding interfaces, tabulating the local solution operator $\\mathbf{H}_i$.'],
      ['Interface solve.', 'Stitch the local operators into a global absorbing Markov chain over interface collocation points ($B$ per edge) and recover their values via a single sparse linear solve.'],
      ['Interior reconstruction.', 'With every tile\'s boundary now known, apply $\\mathbf{H}_i$ to fill the $B \\times B$ interior of each tile in parallel. The final resolution is $N = T \\times B$.'],
    ];

    // ---- Scenes (mirror the mixed-problem demo) ------------------
    const scenes = [
      {
        name: 'Centered circle',
        make: () => ({ circles: [{ cx: 0.5, cy: 0.5, r: 0.18 }], rects: [] })
      },
      {
        name: 'Slit barrier',
        make: () => ({ circles: [], rects: [{ x0: 0.14, y0: 0.485, x1: 0.86, y1: 0.515 }] })
      },
      {
        name: 'Cavity',
        make: () => {
          const t = 0.025, xL = 0.28, xR = 0.72, yB = 0.20, yT = 0.62;
          return {
            circles: [], rects: [
              { x0: xL, y0: yB, x1: xL + t, y1: yT },
              { x0: xR - t, y0: yB, x1: xR, y1: yT },
              { x0: xL, y0: yT - t, x1: xR, y1: yT },
            ]
          };
        }
      },
      {
        name: 'Z-maze',
        make: () => ({
          circles: [], rects: [
            { x0: 0.0, y0: 0.66, x1: 0.66, y1: 0.685 },
            { x0: 0.34, y0: 0.315, x1: 1.0, y1: 0.34 },
          ]
        })
      },
      {
        name: 'No obstacle',
        make: () => ({ circles: [], rects: [] })
      },
    ];
    let sceneIdx = 0;
    let stage = parseInt(stageSlider.value);
    let T = parseInt(tilesSlider.value);
    let B = parseInt(subSlider.value);

    // Animated reveal of the tile interfaces, eased toward whether the
    // decomposition is active (stage >= 1). Mirrors the #i2 demo: each
    // line both fades in and grows outward from its midpoint, staggered
    // by index so the grid cascades into place rather than popping on.
    let ifaceReveal = stage >= 1 ? 1 : 0;
    // Eased opacity for the interface collocation dots (stage >= 3) and the
    // reconstructed interior pixels (stage >= 4), so those layers fade in/out
    // when crossing the 2↔3 and 3↔4 boundaries instead of popping on.
    let colloReveal = stage >= 3 ? 1 : 0;
    let pixelReveal = stage >= 4 ? 1 : 0;
    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
    function approach(cur, target, rate) {
      if (cur < target) return Math.min(target, cur + rate);
      if (cur > target) return Math.max(target, cur - rate);
      return cur;
    }

    // ---- Boundary presets (mirrors the mixed-problem demo) -------
    // Each preset is a function f(i, j, N) → value in [-1, 1] used
    // for any cell tagged Dirichlet on the outer band.
    function arcOf(i, j, N) {
      // Same perimeter parametrization as interactive_neumann.js but
      // expressed in cell-index units; total perimeter = 4*N.
      const dB = j, dT = N - 1 - j, dL = i, dR = N - 1 - i;
      const m = Math.min(dB, dT, dL, dR);
      if (m === dB) return i + 0.5;
      if (m === dR) return N + (j + 0.5);
      if (m === dT) return 2 * N + (N - 1 - i + 0.5);
      return 3 * N + (N - 1 - j + 0.5);
    }
    function arcDist(a, b, P) {
      const d = Math.abs(a - b); return Math.min(d, P - d);
    }
    const presets = [
      {
        name: 'Top hot, bottom cold',
        fn: (i, j, N) => -1 + 2 * (j / (N - 1))
      },
      {
        name: 'Left hot, right cold',
        fn: (i, j, N) => 1 - 2 * (i / (N - 1))
      },
      {
        name: 'Diagonal',
        fn: (i, j, N) => -1 + 2 * ((i + j) / (2 * (N - 1)))
      },
      {
        name: 'Sides hot, top/bottom cold',
        fn: (i, j, N) => {
          const dB = j, dT = N - 1 - j, dL = i, dR = N - 1 - i;
          const m = Math.min(dB, dT, dL, dR);
          return (m === dL || m === dR) ? 1 : -1;
        }
      },
      {
        name: 'Dipole (top hot, bottom cold)',
        fn: (i, j, N) => {
          const P = 4 * N;
          const a = arcOf(i, j, N);
          const cT = 2.5 * N, cB = 0.5 * N;
          const sigma = N * 0.16;
          const gT = Math.exp(-(arcDist(a, cT, P) ** 2) / (sigma * sigma));
          const gB = Math.exp(-(arcDist(a, cB, P) ** 2) / (sigma * sigma));
          return gT - gB;
        }
      },
    ];
    let presetIdx = 0;

    // ---- Geometry helpers ----------------------------------------
    function isInsideObstacle(x, y) {
      const sc = scenes[sceneIdx].make();
      for (const c of sc.circles) if (Math.hypot(x - c.cx, y - c.cy) < c.r) return true;
      for (const r of sc.rects) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
      return false;
    }

    // ---- FD solve cache ------------------------------------------
    // Solve on an N×N grid with thin Dirichlet band (1 cell), top = +1,
    // bottom = -1, left/right linearly interpolated.
    let cached = { T: -1, B: -1, sceneIdx: -1, presetIdx: -1, grid: null, N: 0 };
    function solveIfNeeded() {
      if (cached.T === T && cached.B === B
        && cached.sceneIdx === sceneIdx && cached.presetIdx === presetIdx) return cached.grid;
      // Direct solve is exact at any N, so use the display resolution
      // directly (with a small floor to keep obstacle masking smooth).
      const Nfd = Math.max(48, T * B);
      const g = L.makeGrid(Nfd);
      const fn = presets[presetIdx].fn;
      for (let j = 0; j < Nfd; j++) {
        for (let i = 0; i < Nfd; i++) {
          const k = j * Nfd + i;
          const x = (i + 0.5) / Nfd;
          const y = (j + 0.5) / Nfd;
          const onBand = (i === 0 || i === Nfd - 1 || j === 0 || j === Nfd - 1);
          if (onBand) {
            g.tag[k] = L.D;
            g.u[k] = Math.max(-1, Math.min(1, fn(i, j, Nfd)));
          } else if (isInsideObstacle(x, y)) {
            g.tag[k] = L.N;
            g.u[k] = 0;
          } else {
            g.tag[k] = L.F;
            g.u[k] = 0;
          }
        }
      }
      L.solve(g, 600);
      cached = { T, B, sceneIdx, presetIdx, grid: g, N: Nfd };
      return g;
    }

    function sampleU(x, y) {
      const g = cached.grid;
      const Nfd = cached.N;
      const i = Math.min(Nfd - 1, Math.max(0, Math.floor(x * Nfd)));
      const j = Math.min(Nfd - 1, Math.max(0, Math.floor(y * Nfd)));
      return g.u[j * Nfd + i];
    }

    // ---- Drawing primitives --------------------------------------
    function px(x) { return x * size; }
    function py(y) { return (1 - y) * size; }

    function drawDomainHeatmap() {
      // Draw the FD solution as a background heatmap (used in stages 3-4
      // but kept faint in earlier stages for context).
      const g = cached.grid;
      const Nfd = cached.N;
      const cell = size / Nfd;
      for (let j = 0; j < Nfd; j++) {
        for (let i = 0; i < Nfd; i++) {
          const k = j * Nfd + i;
          if (g.tag[k] === L.N) continue;
          const v = g.u[k];
          const t = (v + 1) * 0.5;
          ctx.fillStyle = U.colormap(t, theme);
          ctx.fillRect(i * cell, (Nfd - 1 - j) * cell, cell + 0.6, cell + 0.6);
        }
      }
    }

    function drawObstacles() {
      const sc = scenes[sceneIdx].make();
      ctx.save();
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const c of sc.circles) {
        ctx.beginPath();
        ctx.arc(px(c.cx), py(c.cy), c.r * size, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      for (const r of sc.rects) {
        const x = px(r.x0), y = py(r.y1);
        const w = (r.x1 - r.x0) * size, h = (r.y1 - r.y0) * size;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();
    }

    function drawOuterBoundary() {
      ctx.save();
      ctx.strokeStyle = theme.dirichlet;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
      ctx.restore();
    }

    function drawTileInterfaces() {
      if (T < 2 || ifaceReveal <= 0.001) return;
      // Ordered list of interface segments (vertical + horizontal per
      // index, interleaved) so the cascade marches outward from center.
      const segs = [];
      for (let i = 1; i < T; i++) {
        const t = i / T;
        segs.push([t, 0, t, 1]); // vertical line x = t
        segs.push([0, t, 1, t]); // horizontal line y = t
      }
      ctx.save();
      ctx.strokeStyle = theme.interface;
      ctx.lineWidth = 1.4;
      const n = segs.length;
      const STAGGER = 0.5; // fraction of the timeline spread across lines
      for (let k = 0; k < n; k++) {
        const s = segs[k];
        // Per-line progress, delayed by its index then eased.
        const delay = n > 1 ? STAGGER * (k / (n - 1)) : 0;
        const span = 1 - STAGGER;
        let p = (ifaceReveal - delay) / (span || 1);
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        const e = easeOut(p);
        if (e <= 0.001) continue;
        const ax = px(s[0]), ay = py(s[1]), bx = px(s[2]), by = py(s[3]);
        const cx = (ax + bx) / 2, cy = (ay + by) / 2;
        ctx.globalAlpha = 0.85 * e;
        ctx.beginPath();
        ctx.moveTo(cx + (ax - cx) * e, cy + (ay - cy) * e);
        ctx.lineTo(cx + (bx - cx) * e, cy + (by - cy) * e);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---- Stage 2: animated local walks ---------------------------
    // Real Walk-on-Stars trajectories using the shared solver. Walks
    // are absorbed by tile interfaces (kind 'I'), Dirichlet outer walls,
    // and reflect off Neumann obstacles — exactly like the tiling demo.
    let walks = [];       // active: {pts, shown, t0}
    let ghostWalks = [];  // fading completed: {pts, tEnd}
    function tileBox(tr, tc) {
      return { x0: tc / T, y0: tr / T, x1: (tc + 1) / T, y1: (tr + 1) / T };
    }
    function buildWalkScene() {
      const sc = scenes[sceneIdx].make();
      const rects = sc.rects.map(r => ({ ...r, kind: 'N' }));
      const circles = sc.circles.map(c => ({ ...c, kind: 'N' }));
      // Outer Dirichlet square + per-tile-row/column interfaces
      const walls = [
        { x0: 0, y0: 1, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 1, y0: 0, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 1, y1: 0, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 0, y1: 1, kind: 'D', value: 0 },
      ];
      const tileInterfaces = [];
      if (T > 1) {
        for (let i = 1; i < T; i++) {
          const t = i / T;
          tileInterfaces.push({ x0: t, y0: 0, x1: t, y1: 1 });
          tileInterfaces.push({ x0: 0, y0: t, x1: 1, y1: t });
        }
      }
      return { walls, rects, circles, tileInterfaces, mode: 'wost' };
    }
    let walkScene = buildWalkScene();
    function rebuildWalkScene() { walkScene = buildWalkScene(); }

    function spawnWalk(now) {
      for (let tries = 0; tries < 30; tries++) {
        const tr = Math.floor(Math.random() * T);
        const tc = Math.floor(Math.random() * T);
        const tb = tileBox(tr, tc);
        // Inset slightly so we don't start on top of an interface
        const m = (tb.x1 - tb.x0) * 0.15;
        const x0 = tb.x0 + m + Math.random() * (tb.x1 - tb.x0 - 2 * m);
        const y0 = tb.y0 + m + Math.random() * (tb.y1 - tb.y0 - 2 * m);
        if (isInsideObstacle(x0, y0)) continue;
        const r = S.walk(walkScene, x0, y0, true);
        if (r.points && r.points.length > 1) {
          walks.push({ pts: r.points, shown: 1, t0: now });
        }
        return;
      }
    }
    function drawOneWalk(pts, upTo, alpha) {
      // Sphere chain
      ctx.fillStyle = theme.accent;
      ctx.strokeStyle = theme.accent;
      for (let s = 0; s < upTo - 1; s++) {
        const a = pts[s], b = pts[s + 1];
        const r = Math.hypot(b[0] - a[0], b[1] - a[1]) * size;
        if (r < 1) continue;
        ctx.globalAlpha = alpha * 0.06;
        ctx.beginPath(); ctx.arc(px(a[0]), py(a[1]), r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = alpha * 0.30;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.arc(px(a[0]), py(a[1]), r, 0, Math.PI * 2); ctx.stroke();
      }
      // Path
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = theme.walk;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
      for (let s = 1; s < upTo; s++) ctx.lineTo(px(pts[s][0]), py(pts[s][1]));
      ctx.stroke();
      // Leading dot
      const last = pts[upTo - 1];
      if (!last) return;
      ctx.fillStyle = theme.walk;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(px(last[0]), py(last[1]), 2.5, 0, Math.PI * 2); ctx.fill();
    }

    const GHOST_FADE_MS = 1500;
    function drawWalks(now) {
      ctx.save();
      // Ghost trails (fading)
      for (let i = ghostWalks.length - 1; i >= 0; i--) {
        const g = ghostWalks[i];
        const age = now - g.tEnd;
        const alpha = Math.max(0, 0.45 * (1 - age / GHOST_FADE_MS));
        if (alpha <= 0) { ghostWalks.splice(i, 1); continue; }
        drawOneWalk(g.pts, g.pts.length, alpha);
      }
      // Active walks
      for (let i = walks.length - 1; i >= 0; i--) {
        const w = walks[i];
        const elapsed = now - w.t0;
        w.shown = Math.min(w.pts.length, 1 + Math.floor(elapsed / 35));
        drawOneWalk(w.pts, w.shown, 1);
        if (w.shown >= w.pts.length) {
          ghostWalks.push({ pts: w.pts, tEnd: now });
          walks.splice(i, 1);
        }
      }
      ctx.restore();
    }

    // ---- Collocation points --------------------------------------
    // Per paper §6.1: B panels per tile edge with collocation point
    // at the panel center; B×B interior points per tile.
    function drawCollocationDot(x, y, value, sizePx) {
      if (isInsideObstacle(x, y)) return;
      const t = (Math.max(-1, Math.min(1, value)) + 1) * 0.5;
      ctx.fillStyle = U.colormap(t, theme);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(px(x), py(y), sizePx, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    function drawInterfaceCollocation() {
      // Only interior (between-tile) interfaces.
      if (T < 2 || colloReveal <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = easeOut(colloReveal);
      const N = T * B;
      const dotR = Math.max(2.0, Math.min(4.5, size / (N * 2.6)));
      // Vertical interior interfaces (x = i/T, i=1..T-1)
      for (let i = 1; i < T; i++) {
        const x = i / T;
        for (let k = 0; k < N; k++) {
          const y = (k + 0.5) / N;
          const v = sampleU(x, y);
          drawCollocationDot(x, y, v, dotR);
        }
      }
      // Horizontal interior interfaces (y = i/T)
      for (let i = 1; i < T; i++) {
        const y = i / T;
        for (let k = 0; k < N; k++) {
          const x = (k + 0.5) / N;
          const v = sampleU(x, y);
          drawCollocationDot(x, y, v, dotR);
        }
      }
      ctx.restore();
    }

    function drawInteriorPixels() {
      // Render the reconstructed interior as an N×N pixel heatmap, with
      // each pixel = one B×B sub-tile cell colored by the FD solution.
      if (pixelReveal <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = easeOut(pixelReveal);
      const N = T * B;
      const cell = size / N;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const x = (i + 0.5) / N;
          const y = (j + 0.5) / N;
          if (isInsideObstacle(x, y)) continue;
          const v = sampleU(x, y);
          const t = (Math.max(-1, Math.min(1, v)) + 1) * 0.5;
          ctx.fillStyle = U.colormap(t, theme);
          ctx.fillRect(i * cell, (N - 1 - j) * cell, cell + 0.6, cell + 0.6);
        }
      }
      ctx.restore();
    }

    // ---- Render --------------------------------------------------
    function render(now) {
      ctx.clearRect(0, 0, size, size);
      // Solid background tone for stages 0-2 so things read clearly;
      // stages 3-4 keep a white background underneath the dots.
      ctx.fillStyle = theme.surface;
      ctx.fillRect(0, 0, size, size);

      // Solve cache (stages 3-4 need it; keep warm while their layers are
      // still fading out after dropping below the stage threshold).
      if (stage >= 3 || colloReveal > 0.001 || pixelReveal > 0.001) solveIfNeeded();

      // Stage 0: outer boundary + obstacles always
      drawObstacles();

      // Stage 4: pixels go *under* the interfaces and obstacle outline.
      if (pixelReveal > 0.001) drawInteriorPixels();
      // Re-stroke obstacle outlines on top of pixels so they remain visible.
      if (pixelReveal > 0.001) drawObstacles();

      if (ifaceReveal > 0.001) drawTileInterfaces();
      if (stage === 2) drawWalks(now || performance.now());
      if (colloReveal > 0.001) drawInterfaceCollocation();

      drawOuterBoundary();
    }

    // ---- Animation loop ------------------------------------------
    // Runs while stage 2 walks are animating, OR while the interface
    // reveal is still easing toward its target (so the cascade can play
    // when crossing into/out of the decomposition stage).
    let rafId = null, lastSpawn = 0, lastT = null;
    function ifaceTarget() { return stage >= 1 ? 1 : 0; }
    function colloTarget() { return stage >= 3 ? 1 : 0; }
    function pixelTarget() { return stage >= 4 ? 1 : 0; }
    function needsAnimation() {
      return stage === 2
        || ifaceReveal !== ifaceTarget()
        || colloReveal !== colloTarget()
        || pixelReveal !== pixelTarget();
    }
    function tick(t) {
      // Ease each layer's reveal toward its target before drawing.
      const dt = lastT == null ? 0 : t - lastT;
      lastT = t;
      const rate = dt / 600; // full reveal/hide in ~600ms
      ifaceReveal = approach(ifaceReveal, ifaceTarget(), rate);
      colloReveal = approach(colloReveal, colloTarget(), rate);
      pixelReveal = approach(pixelReveal, pixelTarget(), rate);

      if (stage === 2 && walks.length < 5 && t - lastSpawn > 130) {
        spawnWalk(t); lastSpawn = t;
      }
      render(t);

      if (needsAnimation()) {
        rafId = requestAnimationFrame(tick);
      } else {
        walks = []; ghostWalks = [];
        rafId = null; lastT = null;
      }
    }
    function startLoopIfNeeded() {
      if (rafId === null && needsAnimation()) {
        lastT = null;
        rafId = requestAnimationFrame(tick);
      }
    }

    // ---- Scene preset thumbnails ---------------------------------
    function buildSceneThumbnail(sc, pxs) {
      const c = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      c.width = pxs * dpr; c.height = pxs * dpr;
      c.style.width = pxs + 'px'; c.style.height = pxs + 'px';
      const cx = c.getContext('2d');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.fillStyle = theme.surface;
      cx.fillRect(0, 0, pxs, pxs);
      cx.strokeStyle = theme.dirichlet;
      cx.lineWidth = 1.5;
      cx.strokeRect(1, 1, pxs - 2, pxs - 2);
      const { circles, rects } = sc.make();
      cx.fillStyle = theme.neumannFill;
      cx.strokeStyle = theme.neumann;
      cx.lineWidth = 1;
      cx.setLineDash([3, 2]);
      for (const cc of circles) {
        cx.beginPath();
        cx.arc(cc.cx * pxs, (1 - cc.cy) * pxs, cc.r * pxs, 0, Math.PI * 2);
        cx.fill(); cx.stroke();
      }
      for (const r of rects) {
        const x = r.x0 * pxs, y = (1 - r.y1) * pxs;
        const w = (r.x1 - r.x0) * pxs, h = (r.y1 - r.y0) * pxs;
        cx.fillRect(x, y, w, h); cx.strokeRect(x, y, w, h);
      }
      cx.setLineDash([]);
      return c;
    }

    const sceneButtons = [];
    scenes.forEach((sc, idx) => {
      const b = document.createElement('button');
      b.title = sc.name;
      b.appendChild(buildSceneThumbnail(sc, 40));
      b.addEventListener('click', () => {
        if (idx === sceneIdx) return;
        sceneIdx = idx;
        updateSceneHighlight();
        rebuildWalkScene();
        walks = []; ghostWalks = [];
        render();
      });
      scenePresetsDiv.appendChild(b);
      sceneButtons.push(b);
    });
    function updateSceneHighlight() {
      sceneButtons.forEach((b, i) => {
        b.style.borderColor = (i === sceneIdx) ? 'var(--color-accent, #2a5fb8)' : '';
      });
    }
    updateSceneHighlight();

    // ---- Boundary preset thumbnails ------------------------------
    // Render each preset's harmonic extension on the empty unit square
    // (no obstacles) at low resolution — same idea as interactive_neumann.
    function buildBoundaryThumbnail(fn, pxs) {
      const Nt = 40;
      const tg = L.makeGrid(Nt);
      for (let jj = 0; jj < Nt; jj++) {
        for (let ii = 0; ii < Nt; ii++) {
          const k = jj * Nt + ii;
          if (ii === 0 || ii === Nt - 1 || jj === 0 || jj === Nt - 1) {
            tg.tag[k] = L.D;
            tg.u[k] = Math.max(-1, Math.min(1, fn(ii, jj, Nt)));
          }
        }
      }
      L.solve(tg, 250);
      const c = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      c.width = pxs * dpr; c.height = pxs * dpr;
      c.style.width = pxs + 'px'; c.style.height = pxs + 'px';
      const cx = c.getContext('2d');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let py2 = 0; py2 < pxs; py2++) {
        for (let px2 = 0; px2 < pxs; px2++) {
          const x = (px2 + 0.5) / pxs;
          const y = 1 - (py2 + 0.5) / pxs;
          const ii = Math.min(Nt - 1, Math.max(0, Math.floor(x * Nt)));
          const jj = Math.min(Nt - 1, Math.max(0, Math.floor(y * Nt)));
          const v = tg.u[jj * Nt + ii];
          cx.fillStyle = U.colormap((v + 1) * 0.5, theme);
          cx.fillRect(px2, py2, 1.05, 1.05);
        }
      }
      return c;
    }

    const presetButtons = [];
    presets.forEach((p, idx) => {
      const b = document.createElement('button');
      b.title = p.name;
      b.appendChild(buildBoundaryThumbnail(p.fn, 40));
      b.addEventListener('click', () => {
        if (idx === presetIdx) return;
        presetIdx = idx;
        updatePresetHighlight();
        render();
      });
      presetsDiv.appendChild(b);
      presetButtons.push(b);
    });
    function updatePresetHighlight() {
      presetButtons.forEach((b, i) => {
        b.style.borderColor = (i === presetIdx) ? 'var(--color-accent, #2a5fb8)' : '';
      });
    }
    updatePresetHighlight();

    // ---- Wire up controls ----------------------------------------
    function updateLabels() {
      stageLabel.textContent = STAGE_NAMES[stage];
      tilesLabel.textContent = String(T);
      subLabel.textContent = String(B);
      resLabel.textContent = `N = T × B = ${T * B}`;
      const tilingActive = stage >= 1;
      const subActive = stage >= 3;
      tilesSlider.disabled = !tilingActive;
      subSlider.disabled = !subActive;
      const opTiles = tilingActive ? '1' : '0.4';
      const opSub = subActive ? '1' : '0.4';
      for (const el of [tilesSlider, tilesSlider.previousElementSibling]) {
        if (el) el.style.opacity = opTiles;
      }
      for (const el of [subSlider, resLabel, subSlider.previousElementSibling]) {
        if (el) el.style.opacity = opSub;
      }
      if (stageDesc) {
        const [name, body] = STAGE_DESCRIPTIONS[stage];
        stageDesc.innerHTML = '';
        const b = document.createElement('b');
        b.textContent = name + ' ';
        stageDesc.appendChild(b);
        const span = document.createElement('span');
        span.textContent = body;
        stageDesc.appendChild(span);
        if (window.renderMathInElement) {
          window.renderMathInElement(stageDesc, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
            ],
            throwOnError: false,
          });
        }
      }
    }
    stageSlider.addEventListener('input', () => {
      stage = parseInt(stageSlider.value);
      updateLabels();
      walks = []; ghostWalks = [];
      render();
      startLoopIfNeeded();
    });
    tilesSlider.addEventListener('input', () => {
      T = parseInt(tilesSlider.value);
      updateLabels();
      rebuildWalkScene();
      walks = []; ghostWalks = [];
      render();
    });
    subSlider.addEventListener('input', () => {
      B = parseInt(subSlider.value);
      updateLabels();
      render();
    });

    updateLabels();
    render();
    startLoopIfNeeded();
  }

  W.WoDS.interactivePipeline = init;
})(window);
