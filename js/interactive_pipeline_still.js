/* Studio-only — the WoDS pipeline as still frames, for slide/paper export.
 *
 * A sibling of interactive_pipeline.js with three differences:
 *
 *   1. Geometry is the #coedge-fig domain (Sc.layout(n): Dirichlet square
 *      + n Neumann rectangles) rather than the single-obstacle scenes.
 *   2. Nothing animates. Each stage is a static frame, so the whole figure
 *      is a pure function of (obstacles, T, B, preset, stage, walkSeed) and
 *      re-renders identically at any backing-store resolution.
 *   3. It exports PNGs — one per pipeline stage — instead of video. The
 *      canvas is re-fit at WoDS.captureScale (same lever js/capture.js
 *      pulls), rendered, and read back with toDataURL.
 *
 * The stage-2 frame is the point of the whole thing: instead of a handful
 * of walks fading in and out, every tile gets several complete Walk-on-Stars
 * trajectories, drawn with their star-shaped step regions, a light casing
 * under each path, and endpoint dots — so the local walks read clearly at
 * print size.
 *
 * Walks are generated under a seeded RNG (Math.random is swapped out for
 * the duration) so a given seed always yields the same picture: the
 * on-screen preview and the exported PNG are the same walks.
 */
(function (W) {
  const U = W.WoDS.util;
  const L = W.WoDS.laplace;
  const S = W.WoDS.solver;
  const Sc = W.WoDS.scenes;

  const W0 = 420;          // logical canvas size
  const PAD = 10;          // keeps the 3px Dirichlet stroke off the edge
  const SQ = W0 - 2 * PAD; // unit square side, in logical px
  const STAR_SAMPLES = 96; // angular samples per star-shaped step region

  // Walks per tile. Below 1 the value is a *fraction of tiles* that get a
  // single walk — at T=8 even one walk each is 64 trajectories, too dense to
  // read, and thinning the tiles beats thinning nothing.
  const WALK_DENSITIES = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 6, 7, 8];

  const STAGES = [
    {
      slug: 'domain',
      name: '0 — Domain',
      desc: ['Domain.', 'Outer Dirichlet boundary and Neumann obstacles (dashed) define the geometry.'],
    },
    {
      slug: 'decomposition',
      name: '1 — Decomposition',
      desc: ['Decomposition.', 'Decompose $\\Omega$ into a regular $T \\times T$ grid. Tile interfaces (orange) become absorbing for the local random walks.'],
    },
    {
      slug: 'local-walks',
      name: '2 — Local walks',
      desc: ['Local walks.', 'Within each tile, short Walk-on-Stars trajectories estimate first-passage probabilities to the surrounding interfaces, tabulating the local solution operator $\\mathbf{H}_i$.'],
    },
    {
      slug: 'interface-solve',
      name: '3 — Interface solve',
      desc: ['Interface solve.', 'Stitch the local operators into a global absorbing Markov chain over interface collocation points ($B$ per edge) and recover their values via a single sparse linear solve.'],
    },
    {
      slug: 'interior-reconstruction',
      name: '4 — Interior reconstruction',
      desc: ['Interior reconstruction.', 'With every tile\'s boundary now known, apply $\\mathbf{H}_i$ to fill the $B \\times B$ interior of each tile in parallel. The final resolution is $N = T \\times B$.'],
    },
  ];

  // Boundary presets: f(i, j, N) → value in [-1, 1] on the Dirichlet band.
  const PRESETS = [
    { name: 'Top hot, bottom cold', fn: (i, j, N) => -1 + 2 * (j / (N - 1)) },
    { name: 'Left hot, right cold', fn: (i, j, N) => 1 - 2 * (i / (N - 1)) },
    { name: 'Diagonal', fn: (i, j, N) => -1 + 2 * ((i + j) / (2 * (N - 1))) },
    {
      name: 'Sides hot, top/bottom cold',
      fn: (i, j, N) => {
        const m = Math.min(j, N - 1 - j, i, N - 1 - i);
        return (m === i || m === N - 1 - i) ? 1 : -1;
      },
    },
  ];

  // Run fn with Math.random replaced by a seeded LCG. The solver reaches for
  // Math.random directly (via U.randSphere and walkWoSt), so this is the one
  // seam that makes a whole batch of walks reproducible.
  function withSeed(seed, fn) {
    const orig = Math.random;
    let s = (seed >>> 0) || 1;
    Math.random = function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    try { return fn(); } finally { Math.random = orig; }
  }

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const canvas = root.querySelector('canvas.diagram');
    // Not const: the SVG export swaps in a recorder with the same interface
    // and re-runs render(), so there is only ever one drawing path.
    let ctx = U.fitCanvas(canvas, W0, W0);

    const stageSlider = root.querySelector('input[data-role="stage"]');
    const stageLabel = root.querySelector('[data-role="stage-label"]');
    const stageDesc = root.querySelector('[data-role="stage-desc"]');
    const obstSlider = root.querySelector('input[data-role="obstacles"]');
    const obstLabel = root.querySelector('[data-role="obstacles-label"]');
    const tilesSlider = root.querySelector('input[data-role="tiles"]');
    const tilesLabel = root.querySelector('[data-role="tiles-label"]');
    const subSlider = root.querySelector('input[data-role="sub"]');
    const subLabel = root.querySelector('[data-role="sub-label"]');
    const resLabel = root.querySelector('[data-role="res-label"]');
    const wptSlider = root.querySelector('input[data-role="wpt"]');
    const wptLabel = root.querySelector('[data-role="wpt-label"]');
    const formatSel = root.querySelector('select[data-role="format"]');
    const scaleSlider = root.querySelector('input[data-role="scale"]');
    const scaleLabel = root.querySelector('[data-role="scale-label"]');
    const scaleRow = root.querySelector('[data-role="scale-row"]');
    const alphaBox = root.querySelector('input[data-role="alpha"]');
    const starsBox = root.querySelector('input[data-role="stars"]');
    const presetsDiv = root.querySelector('[data-role="presets"]');
    const rerollBtn = root.querySelector('[data-role="reroll"]');
    const exportOneBtn = root.querySelector('[data-role="export-one"]');
    const exportAllBtn = root.querySelector('[data-role="export-all"]');

    let stage = parseInt(stageSlider.value);
    let nObst = parseInt(obstSlider.value);
    let T = parseInt(tilesSlider.value);
    let B = parseInt(subSlider.value);
    let density = WALK_DENSITIES[parseInt(wptSlider.value)];
    let exportScale = parseInt(scaleSlider.value);
    let presetIdx = 0;
    let walkSeed = 1;

    // ---- Geometry -------------------------------------------------
    let rects = Sc.layout(nObst).rects;
    function isInsideObstacle(x, y, slack) {
      slack = slack || 0;
      for (const r of rects) {
        if (x > r.x0 - slack && x < r.x1 + slack &&
            y > r.y0 - slack && y < r.y1 + slack) return true;
      }
      return false;
    }

    function px(x) { return PAD + x * SQ; }
    function py(y) { return PAD + (1 - y) * SQ; }

    // ---- Walk scene: interfaces absorb, obstacles reflect ----------
    let walkScene = buildWalkScene();
    function buildWalkScene() {
      return {
        walls: [
          { x0: 0, y0: 1, x1: 1, y1: 1, kind: 'D', value: 0 },
          { x0: 1, y0: 0, x1: 1, y1: 1, kind: 'D', value: 0 },
          { x0: 0, y0: 0, x1: 1, y1: 0, kind: 'D', value: 0 },
          { x0: 0, y0: 0, x1: 0, y1: 1, kind: 'D', value: 0 },
        ],
        rects: rects.map((r) => ({ ...r, kind: 'N' })),
        circles: [],
        tileInterfaces: T > 1 ? Sc.tileInterfaces(T) : [],
        mode: 'wost',
      };
    }

    // ---- FD solve cache (stages 3-4) ------------------------------
    let cached = { key: '', grid: null, N: 0 };
    function solveIfNeeded() {
      const key = [T, B, nObst, presetIdx].join('|');
      if (cached.key === key) return;
      // Floor well above the display resolution so the obstacle mask the
      // supersampler probes is finer than the cells it is filling.
      const Nfd = Math.max(96, T * B);
      const g = L.makeGrid(Nfd);
      const fn = PRESETS[presetIdx].fn;
      for (let j = 0; j < Nfd; j++) {
        for (let i = 0; i < Nfd; i++) {
          const k = j * Nfd + i;
          const x = (i + 0.5) / Nfd, y = (j + 0.5) / Nfd;
          if (i === 0 || i === Nfd - 1 || j === 0 || j === Nfd - 1) {
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
      cached = { key, grid: g, N: Nfd };
    }
    // Cells inside an obstacle are tagged Neumann and hold u = 0, which the
    // diverging colormap paints as its cream midpoint. Reading one by accident
    // (a probe just outside a rectangle can still quantize into it) would ring
    // every obstacle in pale seams, so sampling refuses those cells outright.
    function sampleU(x, y) {
      const g = cached.grid, Nfd = cached.N;
      const i = Math.min(Nfd - 1, Math.max(0, Math.floor(x * Nfd)));
      const j = Math.min(Nfd - 1, Math.max(0, Math.floor(y * Nfd)));
      const k = j * Nfd + i;
      return g.tag[k] === L.N ? null : g.u[k];
    }

    // Nearest free value, for points that must be colored (collocation dots
    // sitting a hair inside an obstacle's quantized footprint).
    function sampleNear(x, y) {
      const v = sampleU(x, y);
      if (v !== null) return v;
      const Nfd = cached.N, h = 1 / Nfd;
      for (let ring = 1; ring <= 3; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const w = sampleU(x + dx * h, y + dy * h);
            if (w !== null) return w;
          }
        }
      }
      return 0;
    }

    // ---- Walk cache -----------------------------------------------
    // One batch of complete trajectories, in unit coords, regenerated only
    // when the geometry/tiling/seed changes. Rendering never touches the RNG,
    // so the export is pixel-identical to the preview.
    let walkCache = { key: '', walks: [] };

    // A star is the disk of radius r with each direction clipped to the first
    // Neumann hit. When no ray hits anything the notched disk IS a disk, and
    // saying so lets the SVG export emit <circle> instead of a 96-gon — about
    // half the stars in a typical frame, and most of its weight.
    function computeStar(cx, cy, r) {
      const poly = new Array(STAR_SAMPLES);
      let notched = false;
      for (let k = 0; k < STAR_SAMPLES; k++) {
        const a = (k / STAR_SAMPLES) * Math.PI * 2;
        const vx = Math.cos(a), vy = Math.sin(a);
        const hit = S.rayHitNeumann(cx, cy, vx, vy, r, walkScene);
        const t = Math.min(r, hit.t);
        if (t < r - 1e-9) notched = true;
        poly[k] = [cx + vx * t, cy + vy * t];
      }
      return { cx, cy, r, poly: notched ? poly : null };
    }

    function buildStars(points, radii) {
      const stars = [];
      const n = Math.min(radii.length, points.length - 1);
      for (let i = 0; i < n; i++) {
        const c = points[i], rad = radii[i];
        // Sub-pixel stars would render as specks; skip them.
        stars.push(rad * SQ >= 1.5 ? computeStar(c[0], c[1], rad) : null);
      }
      return stars;
    }

    function traceStar(star) {
      ctx.beginPath();
      if (!star.poly) {
        ctx.arc(px(star.cx), py(star.cy), star.r * SQ, 0, Math.PI * 2);
        return;
      }
      ctx.moveTo(px(star.poly[0][0]), py(star.poly[0][1]));
      for (let k = 1; k < star.poly.length; k++) {
        ctx.lineTo(px(star.poly[k][0]), py(star.poly[k][1]));
      }
      ctx.closePath();
    }

    // Which tiles get walks, and how many each. A density >= 1 is walks per
    // tile, on every tile. Below 1 it's the fraction of tiles that get one
    // walk, drawn without replacement so the coverage stays even.
    function tileAssignment() {
      const tiles = [];
      for (let tr = 0; tr < T; tr++) {
        for (let tc = 0; tc < T; tc++) tiles.push([tr, tc]);
      }
      if (density >= 1) return tiles.map((t) => [t[0], t[1], density]);
      const keep = Math.max(1, Math.round(density * tiles.length));
      for (let i = tiles.length - 1; i > 0; i--) { // Fisher-Yates, seeded
        const j = Math.floor(Math.random() * (i + 1));
        const t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t;
      }
      return tiles.slice(0, keep).map((t) => [t[0], t[1], 1]);
    }

    function buildWalks() {
      const key = [nObst, T, density, walkSeed].join('|');
      if (walkCache.key === key) return walkCache.walks;
      const out = [];
      withSeed(walkSeed, () => {
        for (const [tr, tc, n] of tileAssignment()) {
          const x0 = tc / T, y0 = tr / T, w = 1 / T;
          const m = w * 0.18; // stay off the interfaces
          for (let k = 0; k < n; k++) {
            for (let tries = 0; tries < 40; tries++) {
              const sx = x0 + m + Math.random() * (w - 2 * m);
              const sy = y0 + m + Math.random() * (w - 2 * m);
              if (isInsideObstacle(sx, sy, 0.01)) continue;
              const r = S.walk(walkScene, sx, sy, true);
              if (r.points && r.points.length > 1) {
                out.push({ pts: r.points, stars: buildStars(r.points, r.radii) });
              }
              break;
            }
          }
        }
      });
      walkCache = { key, walks: out };
      return out;
    }

    // ---- Drawing --------------------------------------------------
    // `opaque` lays the surface color down first, so the obstacles read as
    // solid grey over the stage-4 heatmap rather than letting the field tint
    // them through the translucent Neumann fill.
    function drawObstacles(opaque) {
      ctx.save();
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const r of rects) {
        const x = px(r.x0), y = py(r.y1);
        const w = (r.x1 - r.x0) * SQ, h = (r.y1 - r.y0) * SQ;
        if (opaque) {
          ctx.fillStyle = theme.surface;
          ctx.fillRect(x, y, w, h);
        }
        ctx.fillStyle = theme.neumannFill;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();
    }

    function drawOuterBoundary() {
      ctx.save();
      ctx.strokeStyle = theme.dirichlet;
      ctx.lineWidth = 3;
      ctx.strokeRect(px(0), py(1), SQ, SQ);
      ctx.restore();
    }

    function drawTileInterfaces() {
      if (T < 2) return;
      ctx.save();
      ctx.strokeStyle = theme.interface;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.85;
      for (let i = 1; i < T; i++) {
        const t = i / T;
        ctx.beginPath(); ctx.moveTo(px(t), py(0)); ctx.lineTo(px(t), py(1)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px(0), py(t)); ctx.lineTo(px(1), py(t)); ctx.stroke();
      }
      ctx.restore();
    }

    // Stage 2, drawn to be seen: all star regions first (so no star ever
    // covers another walk's path), then every path over a surface-colored
    // casing that lifts it off the interfaces and the obstacle hatching.
    function drawWalks() {
      const walks = buildWalks();
      ctx.save();

      if (starsBox.checked) {
        ctx.fillStyle = theme.accent;
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 0.8;
        for (const w of walks) {
          for (const star of w.stars) {
            if (!star) continue;
            traceStar(star);
            ctx.globalAlpha = 0.055;
            ctx.fill();
            ctx.globalAlpha = 0.38;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      // A faint casing separates crossing paths without the walks reading as
      // white-outlined ribbons; it's barely there over the interfaces.
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const w of walks) {
        const pts = w.pts;
        ctx.beginPath();
        ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
        for (let s = 1; s < pts.length; s++) ctx.lineTo(px(pts[s][0]), py(pts[s][1]));
        ctx.strokeStyle = theme.surface;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2.8;
        ctx.stroke();
        ctx.strokeStyle = theme.walk;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }

      // Start in the walk color, absorption point in the boundary color —
      // the two blues of accent/walk are too close to tell apart in print.
      ctx.globalAlpha = 1;
      for (const w of walks) {
        const a = w.pts[0], b = w.pts[w.pts.length - 1];
        endDot(a[0], a[1], 2.4, theme.walk);
        endDot(b[0], b[1], 2.8, theme.dirichlet);
      }
      ctx.restore();
    }

    function endDot(x, y, r, fill) {
      ctx.beginPath();
      ctx.arc(px(x), py(y), r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = theme.surface;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function drawInterfaceCollocation() {
      if (T < 2) return;
      const N = T * B;
      const dotR = Math.max(2.0, Math.min(4.5, SQ / (N * 2.6)));
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 0.6;
      for (let i = 1; i < T; i++) {
        for (let k = 0; k < N; k++) {
          const along = (k + 0.5) / N;
          collocationDot(i / T, along, dotR);   // vertical interfaces
          collocationDot(along, i / T, dotR);   // horizontal interfaces
        }
      }
      ctx.restore();
    }

    function collocationDot(x, y, r) {
      if (isInsideObstacle(x, y)) return;
      const t = (Math.max(-1, Math.min(1, sampleNear(x, y))) + 1) * 0.5;
      ctx.fillStyle = U.colormap(t, theme);
      ctx.beginPath();
      ctx.arc(px(x), py(y), r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    // Value of one reconstruction cell: the mean solution over the part of the
    // cell that actually lies in Ω, estimated with SUPERSAMPLE² probes.
    //
    // Testing the cell *center* instead (the obvious thing) drops the whole
    // cell whenever the center happens to fall in an obstacle, so a thin
    // rectangle punches a staircase of white holes far wider than itself. The
    // obstacle rect then gets drawn inside that hole, ringed by white. Here a
    // cell straddling an obstacle edge still gets the average of its free
    // probes, so the field runs up to the obstacle to within 1/(N·SUPERSAMPLE)
    // and the rect lands on colored ground. Cells with no free probe are left
    // unpainted — they sit under the obstacle, which is drawn opaque on top.
    const SUPERSAMPLE = 4;
    function cellValue(i, j, N) {
      let sum = 0, free = 0;
      for (let b = 0; b < SUPERSAMPLE; b++) {
        for (let a = 0; a < SUPERSAMPLE; a++) {
          const x = (i + (a + 0.5) / SUPERSAMPLE) / N;
          const y = (j + (b + 0.5) / SUPERSAMPLE) / N;
          if (isInsideObstacle(x, y)) continue;
          const v = sampleU(x, y);
          if (v === null) continue;
          sum += v;
          free++;
        }
      }
      return free ? sum / free : null;
    }

    function drawInteriorPixels() {
      const N = T * B;
      const cell = SQ / N;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const v = cellValue(i, j, N);
          if (v === null) continue;
          const t = (Math.max(-1, Math.min(1, v)) + 1) * 0.5;
          ctx.fillStyle = U.colormap(t, theme);
          ctx.fillRect(PAD + i * cell, PAD + (N - 1 - j) * cell, cell + 0.6, cell + 0.6);
        }
      }
    }

    function render() {
      ctx.clearRect(0, 0, W0, W0);
      if (!alphaBox.checked) {
        ctx.fillStyle = theme.surface;
        ctx.fillRect(0, 0, W0, W0);
      }
      if (stage >= 3) solveIfNeeded();

      if (stage >= 4) {
        drawInteriorPixels();
        drawObstacles(true); // solid, over the reconstructed field
      } else {
        drawObstacles(false);
      }
      if (stage >= 1) drawTileInterfaces();
      if (stage === 2) drawWalks();
      if (stage >= 3) drawInterfaceCollocation();
      drawOuterBoundary();
    }

    // ---- Export ----------------------------------------------------
    // Raster: same lever as js/capture.js — bump WoDS.captureScale, re-fit so
    // the backing store grows while the CSS size holds, render, read back.
    function renderStageToPNG(which) {
      const prevScale = W.WoDS.captureScale;
      W.WoDS.captureScale = exportScale;
      U.fitCanvas(canvas, W0, W0);
      const url = withStage(which, () => canvas.toDataURL('image/png'));
      W.WoDS.captureScale = prevScale;
      U.fitCanvas(canvas, W0, W0);
      render();
      return url;
    }

    // Vector: point ctx at a recorder and run the very same render(), so the
    // SVG can never drift from what the canvas shows.
    function renderStageToSVG(which) {
      const rec = W.WoDS.svgRecorder(W0, W0);
      const live = ctx;
      ctx = rec.ctx;
      let svg;
      try {
        svg = withStage(which, () => rec.toSVG());
      } finally {
        ctx = live;
      }
      render();
      return svg;
    }

    function withStage(which, produce) {
      const prev = stage;
      stage = which;
      render();
      const out = produce();
      stage = prev;
      return out;
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

    function exportStage(which) {
      const slug = `pipeline-stage${which}-${STAGES[which].slug}`;
      if (formatSel.value === 'svg') {
        const blob = new Blob([renderStageToSVG(which)], { type: 'image/svg+xml;charset=utf-8' });
        download(URL.createObjectURL(blob), `${slug}.svg`, true);
      } else {
        download(renderStageToPNG(which), `${slug}@${exportScale}x.png`);
      }
    }

    // Chrome drops back-to-back programmatic downloads, so space them out.
    function exportAll() {
      STAGES.forEach((_, i) => setTimeout(() => exportStage(i), i * 400));
    }

    // ---- Boundary preset thumbnails -------------------------------
    function buildThumbnail(fn, pxs) {
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
      for (let b = 0; b < pxs; b++) {
        for (let a = 0; a < pxs; a++) {
          const ii = Math.min(Nt - 1, Math.floor(((a + 0.5) / pxs) * Nt));
          const jj = Math.min(Nt - 1, Math.floor((1 - (b + 0.5) / pxs) * Nt));
          cx.fillStyle = U.colormap((tg.u[jj * Nt + ii] + 1) * 0.5, theme);
          cx.fillRect(a, b, 1.05, 1.05);
        }
      }
      return c;
    }

    const presetButtons = PRESETS.map((p, idx) => {
      const b = document.createElement('button');
      b.title = p.name;
      b.appendChild(buildThumbnail(p.fn, 40));
      b.addEventListener('click', () => {
        if (idx === presetIdx) return;
        presetIdx = idx;
        highlightPresets();
        render();
      });
      presetsDiv.appendChild(b);
      return b;
    });
    function highlightPresets() {
      presetButtons.forEach((b, i) => {
        b.style.borderColor = (i === presetIdx) ? 'var(--color-accent, #2a5fb8)' : '';
      });
    }
    highlightPresets();

    // ---- Controls --------------------------------------------------
    function updateLabels() {
      stageLabel.textContent = STAGES[stage].name;
      obstLabel.textContent = String(nObst);
      tilesLabel.textContent = String(T);
      subLabel.textContent = String(B);
      wptLabel.textContent = density >= 1
        ? String(density)
        : `${density} (${Math.max(1, Math.round(density * T * T))} of ${T * T} tiles)`;
      scaleLabel.textContent = exportScale + '× (' + (W0 * exportScale) + 'px)';
      resLabel.textContent = `N = T × B = ${T * B}`;
      // Export resolution is meaningless for SVG.
      const raster = formatSel.value !== 'svg';
      scaleSlider.disabled = !raster;
      scaleRow.style.opacity = raster ? '1' : '0.4';
      const [name, body] = STAGES[stage].desc;
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

    stageSlider.addEventListener('input', () => {
      stage = parseInt(stageSlider.value);
      updateLabels(); render();
    });
    obstSlider.addEventListener('input', () => {
      nObst = parseInt(obstSlider.value);
      rects = Sc.layout(nObst).rects;
      walkScene = buildWalkScene();
      updateLabels(); render();
    });
    tilesSlider.addEventListener('input', () => {
      T = parseInt(tilesSlider.value);
      walkScene = buildWalkScene();
      updateLabels(); render();
    });
    subSlider.addEventListener('input', () => {
      B = parseInt(subSlider.value);
      updateLabels(); render();
    });
    wptSlider.addEventListener('input', () => {
      density = WALK_DENSITIES[parseInt(wptSlider.value)];
      updateLabels(); render();
    });
    scaleSlider.addEventListener('input', () => {
      exportScale = parseInt(scaleSlider.value);
      updateLabels();
    });
    formatSel.addEventListener('change', updateLabels);
    alphaBox.addEventListener('change', render);
    starsBox.addEventListener('change', render);
    rerollBtn.addEventListener('click', () => { walkSeed++; render(); });
    exportOneBtn.addEventListener('click', () => exportStage(stage));
    exportAllBtn.addEventListener('click', exportAll);

    updateLabels();
    render();
  }

  W.WoDS.interactivePipelineStill = W.WoDS.lazyFigure(init);
})(window);
