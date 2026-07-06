/* Interactive — mixed Dirichlet + zero-Neumann.
 *
 * Same paintable-boundary interaction as Interactive 0, but the
 * interior contains a Neumann obstacle (tagged 'N' in the grid).
 * The Jacobi solver reflects across N cells, so the harmonic
 * extension satisfies ∂u/∂n = 0 on the obstacle's surface.
 *
 * Scenes mirror the simple ones from Section 4 (Interactive 3b)
 * to keep visual continuity.
 */
(function (W) {
  const U = W.WoDS.util;
  const L = W.WoDS.laplace;

  function init(root) {
    const theme = W.WoDS.theme();
    const N = 80;
    const size = 320;

    const canvas = root.querySelector('canvas.diagram');
    const ctx = U.fitCanvas(canvas, size, size);
    const valSlider = root.querySelector('input[data-role="brush"]');
    const valLabel  = root.querySelector('[data-role="brush-val"]');
    const resetBtn  = root.querySelector('button[data-role="reset"]');
    const presetsDiv = root.querySelector('[data-role="presets"]');
    const scenePresetsDiv = root.querySelector('[data-role="scene-presets"]');

    const bandCells = 5;
    const cellPx = size / N;
    const bandPx = bandCells * cellPx;

    const grid = L.makeGrid(N);

    // ---- Scenes ------------------------------------------------
    // Each scene returns a list of obstacles in unit-square coords.
    // Picked so that paired with the boundary presets below, the
    // zero-Neumann effect (isolines bending to meet walls at right
    // angles) is visually unmistakable.
    const scenes = [
      {
        // Single round obstacle. Smooth deflection, isolines clearly
        // wrap around as concentric arcs near the surface.
        name: 'Centered circle',
        make: () => ({
          circles: [{ cx: 0.5, cy: 0.5, r: 0.18 }],
          rects: [],
        }),
      },
      {
        // Horizontal wall with gaps at both ends. Vertical gradients
        // can only "leak" around the tips — isolines crowd into the gaps.
        name: 'Slit barrier',
        make: () => ({
          circles: [],
          rects: [{ x0: 0.14, y0: 0.485, x1: 0.86, y1: 0.515 }],
        }),
      },
      {
        // Vertical wall with a narrow central gap. Horizontal flow
        // squeezes through the opening, lensing the field.
        name: 'Wall with gap',
        make: () => ({
          circles: [],
          rects: [
            { x0: 0.485, y0: 0.14, x1: 0.515, y1: 0.40 },
            { x0: 0.485, y0: 0.60, x1: 0.515, y1: 0.86 },
          ],
        }),
      },
      {
        // U-shaped cavity open at the bottom. The interior of the
        // cavity equilibrates to the value at the opening — a clean
        // illustration of how zero-Neumann walls "shield" a region.
        name: 'Cavity',
        make: () => {
          const t = 0.025;
          const xL = 0.28, xR = 0.72, yB = 0.20, yT = 0.62;
          return {
            circles: [],
            rects: [
              { x0: xL,     y0: yB,     x1: xL + t, y1: yT     }, // left
              { x0: xR - t, y0: yB,     x1: xR,     y1: yT     }, // right
              { x0: xL,     y0: yT - t, x1: xR,     y1: yT     }, // ceiling
            ],
          };
        },
      },
      {
        // Two staggered partial walls — the field has to thread a
        // zigzag. Reproduces the maze scene from Section 4.
        name: 'Z-maze',
        make: () => ({
          circles: [],
          rects: [
            { x0: 0.0,  y0: 0.66,  x1: 0.66, y1: 0.685 },
            { x0: 0.34, y0: 0.315, x1: 1.0,  y1: 0.34  },
          ],
        }),
      },
    ];
    let sceneIdx = 0; // slit barrier — pairs with the default top–bottom preset.

    // Pre-initialised boundary values: top hot, bottom cold.
    function presetValue(i, j) {
      return -1 + 2 * (j / (N - 1));
    }

    function isBandCell(i, j) {
      return i < bandCells || i >= N - bandCells
          || j < bandCells || j >= N - bandCells;
    }

    function isInsideObstacle(x, y) {
      const sc = scenes[sceneIdx].make();
      for (const c of sc.circles) {
        if (Math.hypot(x - c.cx, y - c.cy) < c.r) return true;
      }
      for (const r of sc.rects) {
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
      }
      return false;
    }

    // Map (i, j) interior cell indices to unit-square coords.
    function cellXY(i, j) {
      return [(i + 0.5) / N, (j + 0.5) / N];
    }

    const PERIMETER = 4 * size;
    function cellArc(i, j) {
      const dB = j, dT = N - 1 - j, dL = i, dR = N - 1 - i;
      const m = Math.min(dB, dT, dL, dR);
      const cx = (i + 0.5) * cellPx;
      const cy = (j + 0.5) * cellPx;
      if (m === dB) return cx;
      if (m === dR) return size + cy;
      if (m === dT) return 2*size + (size - cx);
      return 3*size + (size - cy);
    }
    function cursorArc(mx, my) {
      const mathX = mx, mathY = size - my;
      const dB = mathY, dT = size - mathY, dL = mathX, dR = size - mathX;
      const m = Math.min(dB, dT, dL, dR);
      if (m === dB) return mathX;
      if (m === dR) return size + mathY;
      if (m === dT) return 2*size + (size - mathX);
      return 3*size + (size - mathY);
    }
    function arcDist(a, b) {
      const d = Math.abs(a - b);
      return Math.min(d, PERIMETER - d);
    }

    // Tag every cell from scratch: D on the band, N inside obstacles, F otherwise.
    // Preserves D values (boundary paint) when called from applyPreset(fn) by
    // letting `fn` set them; otherwise existing band values are kept.
    function retagCells(boundaryFn) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j*N + i;
          if (isBandCell(i, j)) {
            grid.tag[k] = L.D;
            if (boundaryFn) {
              grid.u[k] = Math.max(-1, Math.min(1, boundaryFn(i, j)));
            }
            continue;
          }
          const [x, y] = cellXY(i, j);
          if (isInsideObstacle(x, y)) {
            grid.tag[k] = L.N;
            grid.u[k] = 0;
          } else {
            grid.tag[k] = L.F;
            // Leave grid.u[k] as is so re-tagging during interaction
            // doesn't wipe the relaxation in progress.
          }
        }
      }
    }

    // Deferred-work queue. Init used to run ~2700 Jacobi sweeps
    // synchronously (the main relax plus a 400-sweep solve per preset
    // thumbnail); with lazy init that ~250ms block landed mid-scroll
    // and visibly hitched the page. Jobs run one per timeout tick so
    // scroll frames get through between them.
    const deferred = [];
    let deferTimer = 0; // guards double-scheduling when a job re-defers
    // `first` jumps the queue: field refinement outranks thumbnails, so
    // the main canvas always converges before peripheral UI fills in.
    function defer(job, first) {
      if (first) deferred.unshift(job); else deferred.push(job);
      scheduleDeferred();
    }
    function scheduleDeferred() {
      if (deferTimer || !deferred.length) return;
      deferTimer = setTimeout(() => {
        deferTimer = 0;
        const job = deferred.shift();
        if (job) job();
        scheduleDeferred();
      }, 16);
    }
    // Flush everything the moment the figure is about to be seen.
    // Safari throttles timers in unfocused/occluded windows to ~1s, so
    // the 16ms drain can stretch to one job per second — thumbnails
    // popping in one by one and the field visibly stepping sharper for
    // many seconds. One synchronous flush on viewport entry guarantees
    // the figure is complete whenever it's actually looked at; in the
    // normal focused case the queue is already empty by then.
    if (W.IntersectionObserver) {
      const flushIO = new IntersectionObserver((entries) => {
        if (!entries[entries.length - 1].isIntersecting) return;
        if (deferTimer) { clearTimeout(deferTimer); deferTimer = 0; }
        while (deferred.length) deferred.shift()(); // jobs may re-defer; chains terminate
        flushIO.disconnect(); // one-shot: later clicks happen focused, timers run full speed
      }, { rootMargin: '96px 0px' });
      flushIO.observe(root);
    }

    // Relax in chunks: a quick first pass gives an immediately
    // presentable field, the rest refines over deferred ticks. A newer
    // call (preset/scene click) supersedes any queued refinement.
    let relaxGen = 0;
    function relaxChunked(total) {
      const gen = ++relaxGen;
      relax(150);
      render();
      let left = total - 150;
      function refine() {
        if (gen !== relaxGen) return;
        relax(Math.min(200, left));
        left -= 200;
        render();
        if (left > 0) defer(refine, true);
      }
      if (left > 0) defer(refine, true);
    }

    function applyPreset(fn) {
      grid.u.fill(0);
      retagCells(fn);
      relaxChunked(700);
    }

    function resetBoundary() { applyPreset(presetValue); }

    function relax(iters) { L.solve(grid, iters); }

    let showIsolines = true;

    // Marching-squares contouring on the cell-centered grid.
    // Node (i, j) sits at screen ((i+0.5)·cell, (N-0.5-j)·cell) — the
    // same convention used by the heatmap fill above.
    const ISO_LEVELS = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];
    function drawIsolines(cell) {
      ctx.save();
      ctx.strokeStyle = 'rgba(17,17,17,0.55)';
      ctx.lineWidth = 1;
      const nodeX = (i) => (i + 0.5) * cell;
      const nodeY = (j) => (N - 0.5 - j) * cell;
      for (const lvl of ISO_LEVELS) {
        ctx.beginPath();
        for (let j = 0; j < N - 1; j++) {
          for (let i = 0; i < N - 1; i++) {
            const k00 = j*N + i,         k10 = j*N + (i+1);
            const k01 = (j+1)*N + i,     k11 = (j+1)*N + (i+1);
            // Stop contours at the obstacle: skip any quad that touches
            // an N node, so segments end at the wall edge — producing
            // the right-angle incidence that signals zero-flux.
            if (grid.tag[k00] === L.N || grid.tag[k10] === L.N
             || grid.tag[k01] === L.N || grid.tag[k11] === L.N) continue;
            const v0 = grid.u[k00], v1 = grid.u[k10];
            const v2 = grid.u[k11], v3 = grid.u[k01];
            const code = (v0>lvl?1:0) | (v1>lvl?2:0)
                       | (v2>lvl?4:0) | (v3>lvl?8:0);
            if (code === 0 || code === 15) continue;
            const x0 = nodeX(i),     x1 = nodeX(i+1);
            const y0 = nodeY(j),     y1 = nodeY(j+1);
            // Edge interpolation. e0=bottom, e1=right, e2=top, e3=left.
            const t = (va, vb) => (va === vb) ? 0.5 : (lvl - va) / (vb - va);
            const e0 = () => [x0 + t(v0, v1) * (x1 - x0), y0];
            const e1 = () => [x1, y0 + t(v1, v2) * (y1 - y0)];
            const e2 = () => [x0 + t(v3, v2) * (x1 - x0), y1];
            const e3 = () => [x0, y0 + t(v0, v3) * (y1 - y0)];
            let segs;
            switch (code) {
              case 1: case 14: segs = [[e3(), e0()]]; break;
              case 2: case 13: segs = [[e0(), e1()]]; break;
              case 3: case 12: segs = [[e3(), e1()]]; break;
              case 4: case 11: segs = [[e1(), e2()]]; break;
              case 6: case 9:  segs = [[e0(), e2()]]; break;
              case 7: case 8:  segs = [[e3(), e2()]]; break;
              case 5:          segs = [[e3(), e0()], [e1(), e2()]]; break;
              case 10:         segs = [[e0(), e1()], [e2(), e3()]]; break;
            }
            for (const s of segs) {
              ctx.moveTo(s[0][0], s[0][1]);
              ctx.lineTo(s[1][0], s[1][1]);
            }
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    function render() {
      ctx.clearRect(0, 0, size, size);
      const cell = size / N;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j*N + i;
          if (grid.tag[k] === L.N) {
            // Obstacle cells drawn as a flat surface tone.
            ctx.fillStyle = theme.surface;
          } else {
            const v = grid.u[k];
            const t = (v + 1) * 0.5;
            ctx.fillStyle = U.colormap(t, theme);
          }
          ctx.fillRect(i*cell, (N-1-j)*cell, cell+0.5, cell+0.5);
        }
      }

      // Isolines (marching squares). Cells touching an N corner are
      // skipped so contour segments terminate cleanly *at* the wall —
      // visually the isolines appear to meet the obstacle at a right
      // angle, which is exactly what ∂u/∂n = 0 enforces.
      if (showIsolines) drawIsolines(cell);

      // Obstacle outline (dashed Neumann color).
      const sc = scenes[sceneIdx].make();
      ctx.save();
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const c of sc.circles) {
        ctx.beginPath();
        ctx.arc(c.cx * size, (1 - c.cy) * size, c.r * size, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      for (const r of sc.rects) {
        const x = r.x0 * size;
        const y = (1 - r.y1) * size;
        const w = (r.x1 - r.x0) * size;
        const h = (r.y1 - r.y0) * size;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      ctx.restore();

      // Boundary band overlay.
      ctx.save();
      ctx.fillStyle = 'rgba(17,17,17,0.07)';
      ctx.fillRect(0, 0, size, bandPx);
      ctx.fillRect(0, size - bandPx, size, bandPx);
      ctx.fillRect(0, bandPx, bandPx, size - 2*bandPx);
      ctx.fillRect(size - bandPx, bandPx, bandPx, size - 2*bandPx);

      // Inner edge of the band — solid, muted. Dashes are reserved for
      // Neumann (reflecting) boundaries site-wide (the obstacle above),
      // so the Dirichlet band uses a solid guide line here.
      ctx.strokeStyle = 'rgba(17,17,17,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bandPx + 0.5, bandPx + 0.5, size - 2*bandPx - 1, size - 2*bandPx - 1);

      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0.75, 0.75, size - 1.5, size - 1.5);
      ctx.restore();
    }

    function updateLabel() {
      const v = parseFloat(valSlider.value);
      const sign = v >= 0 ? '+' : '−';
      valLabel.textContent = `${sign}${Math.abs(v).toFixed(2)}`;
    }

    function paintAt(mx, my) {
      const slop = 4;
      const dL = mx, dR = size - mx, dB = my, dT = size - my;
      const minEdge = Math.min(dL, dR, dB, dT);
      if (minEdge > bandPx + slop) return false;

      const v = parseFloat(valSlider.value);
      const sCursor = cursorArc(mx, my);
      const radArc = bandPx * 1.4;

      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j*N + i;
          if (grid.tag[k] !== L.D) continue;
          const sCell = cellArc(i, j);
          const d = arcDist(sCell, sCursor);
          if (d < radArc) {
            const w = 1 - d / radArc;
            grid.u[k] = Math.max(-1, Math.min(1, grid.u[k]*(1-w) + v*w));
          }
        }
      }
      return true;
    }

    let dragging = false;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) / r.width  * size;
      const my = (e.clientY - r.top)  / r.height * size;
      if (paintAt(mx, my)) { relax(60); render(); }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = canvas.getBoundingClientRect();
      const mx = (e.clientX - r.left) / r.width  * size;
      const my = (e.clientY - r.top)  / r.height * size;
      if (paintAt(mx, my)) { relax(40); render(); }
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(_){}
      relax(250); render();
    });

    // Boundary-value presets — chosen so each one drives a strong
    // gradient *across* one of the scene obstacles, making the
    // zero-Neumann bending of isolines impossible to miss.
    const presets = [
      { name: 'Top hot, bottom cold',   // vertical gradient → slit barrier
        fn: (i, j) => -1 + 2 * (j / (N - 1)) },
      { name: 'Left hot, right cold',   // horizontal gradient → wall w/ gap
        fn: (i, j) =>  1 - 2 * (i / (N - 1)) },
      { name: 'Diagonal',               // corner-to-corner gradient
        fn: (i, j) => -1 + 2 * ((i + j) / (2 * (N - 1))) },
      { name: 'Sides hot, top/bottom cold',
        fn: (i, j) => {
          // Piecewise-constant by nearest edge — produces a clean
          // quadrupole. Pairs nicely with circle / two-pillars.
          const dB = j, dT = N - 1 - j, dL = i, dR = N - 1 - i;
          const m = Math.min(dB, dT, dL, dR);
          return (m === dL || m === dR) ? 1 : -1;
        }},
      { name: 'Dipole (top hot, bottom cold)',
        fn: (i, j) => {
          // Two opposing localized sources — flow streams from one to
          // the other and an obstacle in between routes it around.
          const a = cellArc(i, j);
          const cT = 2.5 * size, cB = 0.5 * size;
          const sigma = size * 0.16;
          const gT = Math.exp(-(arcDist(a, cT)**2) / (sigma*sigma));
          const gB = Math.exp(-(arcDist(a, cB)**2) / (sigma*sigma));
          return gT - gB;
        }},
    ];

    presets.forEach((p) => {
      const b = document.createElement('button');
      b.title = p.name;
      b.appendChild(buildBoundaryThumbnail(p.fn, 40));
      b.addEventListener('click', () => applyPreset(p.fn));
      presetsDiv.appendChild(b);
    });

    // Scene preset buttons.
    const sceneButtons = [];
    scenes.forEach((sc, idx) => {
      const b = document.createElement('button');
      b.title = sc.name;
      b.appendChild(buildSceneThumbnail(sc, 40));
      b.addEventListener('click', () => {
        if (idx === sceneIdx) return;
        sceneIdx = idx;
        updateSceneHighlight();
        // Re-tag (without wiping painted boundary values), then relax.
        retagCells(null);
        relaxChunked(700);
      });
      scenePresetsDiv.appendChild(b);
      sceneButtons.push(b);
    });
    function updateSceneHighlight() {
      sceneButtons.forEach((b, i) => {
        b.style.borderColor = (i === sceneIdx)
          ? 'var(--color-accent, #2a5fb8)' : '';
      });
    }
    updateSceneHighlight();

    // Boundary-value thumbnail: small heatmap of the harmonic extension
    // under the *current* obstacle scene.
    function buildBoundaryThumbnail(fn, px) {
      // Canvas is created (and returned) synchronously so the button
      // grid lays out; the 400-sweep solve + raster runs deferred —
      // five of these back to back were the bulk of the old init block.
      const c = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      c.width = px * dpr; c.height = px * dpr;
      c.style.width = px + 'px'; c.style.height = px + 'px';
      const cx = c.getContext('2d');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      defer(() => {
        const tg = L.makeGrid(N);
        for (let jj = 0; jj < N; jj++) {
          for (let ii = 0; ii < N; ii++) {
            const k = jj*N + ii;
            if (isBandCell(ii, jj)) {
              tg.tag[k] = L.D;
              tg.u[k] = Math.max(-1, Math.min(1, fn(ii, jj)));
            } else {
              const [x, y] = cellXY(ii, jj);
              if (isInsideObstacle(x, y)) tg.tag[k] = L.N;
            }
          }
        }
        L.solve(tg, 400);
        for (let py = 0; py < px; py++) {
          for (let pxn = 0; pxn < px; pxn++) {
            const x = (pxn + 0.5) / px;
            const y = 1 - (py + 0.5) / px;
            const ii = Math.min(N-1, Math.max(0, Math.floor(x * N)));
            const jj = Math.min(N-1, Math.max(0, Math.floor(y * N)));
            const k = jj*N + ii;
            if (tg.tag[k] === L.N) {
              cx.fillStyle = theme.surface;
            } else {
              const v = tg.u[k];
              const t = (v + 1) * 0.5;
              cx.fillStyle = U.colormap(t, theme);
            }
            cx.fillRect(pxn, py, 1.05, 1.05);
          }
        }
      });
      return c;
    }

    function buildSceneThumbnail(sc, px) {
      const c = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      c.width = px * dpr; c.height = px * dpr;
      c.style.width = px + 'px'; c.style.height = px + 'px';
      const cx = c.getContext('2d');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.fillStyle = theme.surface;
      cx.fillRect(0, 0, px, px);
      cx.strokeStyle = theme.dirichlet;
      cx.lineWidth = 1.5;
      cx.strokeRect(1, 1, px - 2, px - 2);
      const { circles, rects } = sc.make();
      cx.fillStyle = theme.neumannFill;
      cx.strokeStyle = theme.neumann;
      cx.lineWidth = 1;
      cx.setLineDash([3, 2]);
      for (const cc of circles) {
        cx.beginPath();
        cx.arc(cc.cx * px, (1 - cc.cy) * px, cc.r * px, 0, Math.PI * 2);
        cx.fill(); cx.stroke();
      }
      for (const r of rects) {
        const x = r.x0 * px;
        const y = (1 - r.y1) * px;
        const w = (r.x1 - r.x0) * px;
        const h = (r.y1 - r.y0) * px;
        cx.fillRect(x, y, w, h);
        cx.strokeRect(x, y, w, h);
      }
      cx.setLineDash([]);
      return c;
    }

    resetBtn.addEventListener('click', resetBoundary);
    valSlider.addEventListener('input', updateLabel);

    const toggleIsoBtn = root.querySelector('button[data-role="toggle-iso"]');
    if (toggleIsoBtn) {
      toggleIsoBtn.addEventListener('click', () => {
        showIsolines = !showIsolines;
        toggleIsoBtn.textContent = showIsolines ? 'Hide isolines' : 'Show isolines';
        render();
      });
    }

    updateLabel();
    resetBoundary();
  }

  W.WoDS.interactiveNeumann = W.WoDS.lazyFigure(init);
})(window);
