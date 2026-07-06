/* Interactive 3b — Poisson kernel as a solution operator.
 *
 * The dual reading of P(x, z): a unit point source on the Dirichlet
 * boundary at z paints the interior with its harmonic extension —
 * which is P(·, z), a single column of the Poisson kernel.
 *
 * Strategy: precompute the full kernel matrix H[i, j, b] once per
 * scene (probability of exiting in boundary bin b given start at
 * grid cell (i, j)), then dragging z is just a smoothed column
 * lookup. The smoothing kernel along the boundary acts as a
 * "spotlight width" and also tames the noise of finite walks.
 */
(function (W) {
  const U = W.WoDS.util;
  const S = W.WoDS.solver;

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const canvas = root.querySelector('canvas.diagram');
    const presetsDiv = root.querySelector('[data-role="scene-presets"]');
    const sigmaSlider = root.querySelector('input[data-role="sigma"]');
    const sigmaLabel = root.querySelector('[data-role="sigma-label"]');
    const statusLabel = root.querySelector('[data-role="status"]');

    const W0 = 480, H0 = 480;
    const ctx = U.fitCanvas(canvas, W0, H0);
    // Small inset so the source disk at z, drawn on the boundary, isn't
    // clipped by the canvas edge.
    const PAD = 18;
    const SQ = W0 - 2 * PAD;

    // KaTeX-rendered "z" overlay. Same approach as the kernel figure.
    const labelParent = canvas.parentNode;
    if (getComputedStyle(labelParent).position === 'static') {
      labelParent.style.position = 'relative';
    }
    const zLabel = document.createElement('span');
    zLabel.style.cssText =
      'position:absolute; pointer-events:none; transform:translate(-50%,-50%);' +
      ' white-space:nowrap; font-size:16px;' +
      ' filter:drop-shadow(0 0 2px var(--color-surface))' +
      ' drop-shadow(0 0 2px var(--color-surface))' +
      ' drop-shadow(0 0 2px var(--color-surface));';
    labelParent.appendChild(zLabel);
    if (W.katex) {
      W.katex.render('z', zLabel, { throwOnError: false });
    } else {
      zLabel.textContent = 'z';
      zLabel.style.fontStyle = 'italic';
    }
    function updateZLabel() {
      const [zx, zy, nx, ny] = perimeterToXY(zParam);
      const zs = toScreen(zx, zy);
      const cw = canvas.clientWidth || W0;
      const ch = canvas.clientHeight || H0;
      // Original baseline-middle text at (zs[0]+nx*12-4, zs[1]-ny*12);
      // glyph center ≈ +4px right of that.
      const lxInt = zs[0] + nx * 12;
      const lyInt = zs[1] - ny * 12;
      zLabel.style.left =
        (canvas.offsetLeft + lxInt / W0 * cw) + 'px';
      zLabel.style.top  =
        (canvas.offsetTop  + lyInt / H0 * ch) + 'px';
    }
    window.addEventListener('resize', () => updateZLabel());

    const Gx = 44, Gy = 44;
    const NBINS = 128;
    let sigmaBound = parseFloat(sigmaSlider ? sigmaSlider.value : 0.1);

    // Precomputed scenes. Each `make()` returns a Neumann obstacle layout.
    // Keep these few and well-chosen — funkier scenes can be added later.
    const sceneDefs = [
      {
        name: 'Empty square',
        make: () => ({ circles: [], rects: [] }),
      },
      {
        name: 'Centered circle',
        make: () => ({
          circles: [{ cx: 0.5, cy: 0.5, r: 0.18, kind: 'N' }],
          rects: [],
        }),
      },
      {
        // A horizontal barrier across the middle with small gaps at the
        // two ends so light has to bend around its tips.
        name: 'Slit barrier',
        make: () => ({
          circles: [],
          rects: [
            { x0: 0.14, y0: 0.485, x1: 0.86, y1: 0.515, kind: 'N' },
          ],
        }),
      },
      {
        // Three short walls forming a U — a "room" in the lower half of
        // the domain, open at the bottom. Source outside lights the inside
        // only via the opening.
        name: 'Room',
        make: () => {
          const t = 0.02; // wall thickness
          const xL = 0.28, xR = 0.72, yB = 0.15, yT = 0.45;
          return {
            circles: [],
            rects: [
              { x0: xL,     y0: yB,     x1: xL + t, y1: yT, kind: 'N' }, // left wall
              { x0: xR - t, y0: yB,     x1: xR,     y1: yT, kind: 'N' }, // right wall
              { x0: xL,     y0: yT - t, x1: xR,     y1: yT, kind: 'N' }, // ceiling
            ],
          };
        },
      },
      {
        // A minimal Z-maze: two staggered partial walls force light to
        // thread between them.
        name: 'Maze',
        make: () => {
          const t = 0.02;
          return {
            circles: [],
            rects: [
              { x0: 0.0,  y0: 0.66, x1: 0.66, y1: 0.66 + t, kind: 'N' },
              { x0: 0.34, y0: 0.34, x1: 1.0,  y1: 0.34 + t, kind: 'N' },
            ],
          };
        },
      },
    ];

    let sceneIdx = 0;

    // Mutable scene used by the solver.
    const scene = {
      walls: [
        { x0:0, y0:1, x1:1, y1:1, kind:'D', value:0 },
        { x0:1, y0:0, x1:1, y1:1, kind:'D', value:0 },
        { x0:0, y0:0, x1:1, y1:0, kind:'D', value:0 },
        { x0:0, y0:0, x1:0, y1:1, kind:'D', value:0 },
      ],
      rects: [],
      circles: [],
      mode: 'wost',
    };

    function rebuildScene() {
      const { circles, rects } = sceneDefs[sceneIdx].make();
      scene.circles = circles.map(c => ({ ...c }));
      scene.rects = rects.map(r => ({ ...r }));
    }

    const toggle = root.querySelector('[data-role="solver-toggle"]');
    if (toggle) {
      scene.mode = toggle.querySelector('input:checked').value;
      toggle.addEventListener('change', (e) => {
        if (e.target && e.target.name) {
          scene.mode = e.target.value;
          // Kernel matrix is solver-specific — recompute from scratch.
          startPrecompute();
        }
      });
    }

    // ---- Boundary parameterization (s ∈ [0, 4)) -----------------------
    // Edges chained CCW from bottom-left:
    //   0..1 bottom, 1..2 right, 2..3 top, 3..4 left.
    function paramOnPerimeter(x, y) {
      const dB = Math.abs(y - 0);
      const dR = Math.abs(x - 1);
      const dT = Math.abs(y - 1);
      const dL = Math.abs(x - 0);
      const m = Math.min(dB, dR, dT, dL);
      let s;
      if (m === dB)      s = 0 + Math.min(1, Math.max(0, x));
      else if (m === dR) s = 1 + Math.min(1, Math.max(0, y));
      else if (m === dT) s = 2 + Math.min(1, Math.max(0, 1 - x));
      else               s = 3 + Math.min(1, Math.max(0, 1 - y));
      return s;
    }
    function perimeterToXY(s) {
      s = ((s % 4) + 4) % 4;
      if (s < 1) return [s,         0,       0, -1];
      if (s < 2) return [1,         s - 1,   1,  0];
      if (s < 3) return [3 - s,     1,       0,  1];
      return       [0,         4 - s,  -1,  0];
    }

    // ---- Obstacle membership / safety margin --------------------------
    function isInsideObstacle(x, y, slack) {
      slack = slack || 0;
      for (const c of scene.circles) {
        if (Math.hypot(x - c.cx, y - c.cy) < c.r + slack) return true;
      }
      for (const r of scene.rects) {
        if (x > r.x0 - slack && x < r.x1 + slack &&
            y > r.y0 - slack && y < r.y1 + slack) return true;
      }
      return false;
    }

    // ---- Kernel matrix H[(j*Gx + i)*NBINS + b] -------------------------
    let H = null;
    let validCell = null;       // Bool array of length Gx*Gy
    let walksPerCell = null;    // running count per cell

    let TARGET_WALKS = 220;     // per cell — extendable via "Add more MC samples"

    let estimating = false;
    let raf = 0;

    function startPrecompute() {
      cancelAnimationFrame(raf);
      TARGET_WALKS = 220; // reset budget when the kernel is rebuilt from scratch
      H = new Float32Array(Gx * Gy * NBINS);
      validCell = new Uint8Array(Gx * Gy);
      walksPerCell = new Uint32Array(Gx * Gy);
      for (let j = 0; j < Gy; j++) {
        for (let i = 0; i < Gx; i++) {
          const x = (i + 0.5) / Gx, y = (j + 0.5) / Gy;
          // Skip cells too close to (or inside) Neumann obstacles — they're
          // numerically fragile and visually shouldn't be lit anyway.
          validCell[j * Gx + i] = isInsideObstacle(x, y, 0.012) ? 0 : 1;
        }
      }
      pass = 0;
      cellIdx = 0;
      estimating = true;
      raf = requestAnimationFrame(progressChunk);
    }

    let pass = 0, cellIdx = 0;

    function progressChunk() {
      if (!estimating) return;
      const t0 = performance.now();
      while (performance.now() - t0 < 28) {
        if (pass >= TARGET_WALKS) {
          estimating = false;
          statusLabel.textContent = `Done — ${TARGET_WALKS} walks/cell, ${Gx}×${Gy} grid.`;
          render();
          return;
        }
        if (cellIdx >= Gx * Gy) {
          pass++;
          cellIdx = 0;
          // Render a checkpoint each pass.
          break;
        }
        if (validCell[cellIdx]) {
          const i = cellIdx % Gx;
          const j = Math.floor(cellIdx / Gx);
          const x = (i + 0.5) / Gx, y = (j + 0.5) / Gy;
          const r = S.walk(scene, x, y, false);
          if (r.kind === 'D') {
            const s = paramOnPerimeter(r.endX, r.endY);
            const b = Math.min(NBINS - 1, Math.max(0, Math.floor(s / 4 * NBINS)));
            H[cellIdx * NBINS + b] += 1;
          }
          walksPerCell[cellIdx]++;
        }
        cellIdx++;
      }
      const pct = Math.round(100 * (pass + cellIdx / (Gx * Gy)) / TARGET_WALKS);
      statusLabel.textContent = `Precomputing kernel… ${pct}%`;
      render();
      raf = requestAnimationFrame(progressChunk);
    }

    // ---- z (boundary source) -------------------------------------------
    // Default at the middle of the bottom edge.
    let zParam = 0.5;

    function projectToPerimeter(x, y) {
      // Snap an arbitrary point in the unit square (or just outside it)
      // to its closest boundary point, then return its perimeter param.
      const cx = Math.max(0, Math.min(1, x));
      const cy = Math.max(0, Math.min(1, y));
      const dB = cy, dT = 1 - cy, dL = cx, dR = 1 - cx;
      const m = Math.min(dB, dT, dL, dR);
      let bx, by;
      if (m === dB)      { bx = cx; by = 0; }
      else if (m === dT) { bx = cx; by = 1; }
      else if (m === dL) { bx = 0;  by = cy; }
      else               { bx = 1;  by = cy; }
      return paramOnPerimeter(bx, by);
    }

    // ---- Rendering -----------------------------------------------------
    function toScreen(x, y) { return [PAD + x * SQ, PAD + (1 - y) * SQ]; }
    function evToScene(e) {
      const r = canvas.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width  * W0;
      const cy = (e.clientY - r.top)  / r.height * H0;
      return [(cx - PAD) / SQ, 1 - (cy - PAD) / SQ];
    }

    function render() {
      ctx.clearRect(0, 0, W0, H0);

      // Compute the smoothed column at zParam.
      // Wrap-around-aware Gaussian weights.
      const w = new Float32Array(NBINS);
      const sigma = sigmaBound;
      for (let b = 0; b < NBINS; b++) {
        const sb = (b + 0.5) / NBINS * 4;
        let d = Math.abs(sb - zParam);
        if (d > 2) d = 4 - d;
        w[b] = Math.exp(-(d * d) / (2 * sigma * sigma));
      }

      // Per-cell value, normalized to [0,1] via the 99th-percentile-like
      // max so a few hot cells don't crush the dynamic range.
      const cells = Gx * Gy;
      const vals = new Float32Array(cells);
      let maxVal = 0;
      if (H) {
        for (let k = 0; k < cells; k++) {
          if (!validCell[k]) continue;
          const Nw = walksPerCell[k] || 1;
          let v = 0;
          const base = k * NBINS;
          for (let b = 0; b < NBINS; b++) v += H[base + b] * w[b];
          v /= Nw; // probability mass on z's smoothed patch from this cell
          vals[k] = v;
          if (v > maxVal) maxVal = v;
        }
      }

      // Background heatmap.
      const cellW = SQ / Gx, cellH = SQ / Gy;
      const denom = maxVal > 1e-12 ? maxVal : 1;
      for (let j = 0; j < Gy; j++) {
        for (let i = 0; i < Gx; i++) {
          const k = j * Gx + i;
          if (!validCell[k]) {
            ctx.fillStyle = theme.surface;
          } else {
            const t = Math.min(1, vals[k] / denom);
            ctx.fillStyle = U.colormap(0.5 - 0.5 * t, theme);
          }
          const px = PAD + i * cellW;
          const py = PAD + (Gy - 1 - j) * cellH;
          ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5);
        }
      }

      // Obstacles.
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const c of scene.circles) {
        const cs = toScreen(c.cx, c.cy);
        ctx.beginPath();
        ctx.arc(cs[0], cs[1], c.r * SQ, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      for (const r of scene.rects) {
        const tl = toScreen(r.x0, r.y1);
        const ww = (r.x1 - r.x0) * SQ;
        const hh = (r.y1 - r.y0) * SQ;
        ctx.fillRect(tl[0], tl[1], ww, hh);
        ctx.strokeRect(tl[0], tl[1], ww, hh);
      }
      ctx.setLineDash([]);

      // Outer Dirichlet square.
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.dirichlet;
      ctx.strokeRect(PAD + 0.5, PAD + 0.5, SQ - 1, SQ - 1);

      // z source disk on the boundary.
      const [zx, zy] = perimeterToXY(zParam);
      const zs = toScreen(zx, zy);
      ctx.save();
      ctx.fillStyle = theme.walk;
      ctx.strokeStyle = theme.bg || '#fff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(zs[0], zs[1], 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // "z" label is a KaTeX HTML overlay — see updateZLabel.
      updateZLabel();
    }

    // ---- Pointer interaction -------------------------------------------
    let dragging = false;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      const [x, y] = evToScene(e);
      zParam = projectToPerimeter(x, y);
      render();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const [x, y] = evToScene(e);
      zParam = projectToPerimeter(x, y);
      render();
    });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });

    if (sigmaSlider) {
      sigmaSlider.addEventListener('input', () => {
        sigmaBound = parseFloat(sigmaSlider.value);
        if (sigmaLabel) sigmaLabel.textContent = sigmaBound.toFixed(2);
        render();
      });
    }

    const recomputeBtn = root.querySelector('button[data-role="recompute"]');
    if (recomputeBtn) {
      recomputeBtn.addEventListener('click', () => {
        // Don't queue extra batches while one is already in flight.
        if (estimating || !H) return;
        TARGET_WALKS += 200;
        estimating = true;
        raf = requestAnimationFrame(progressChunk);
      });
    }

    // ---- Scene thumbnails ----------------------------------------------
    const presetButtons = [];
    if (presetsDiv) {
      sceneDefs.forEach((sd, idx) => {
        const b = document.createElement('button');
        b.title = sd.name;
        b.appendChild(buildSceneThumbnail(sd, 40));
        b.addEventListener('click', () => {
          if (sceneIdx === idx && estimating) return;
          sceneIdx = idx;
          updatePresetHighlight();
          rebuildScene();
          startPrecompute();
        });
        presetsDiv.appendChild(b);
        presetButtons.push(b);
      });
      updatePresetHighlight();
    }

    function updatePresetHighlight() {
      presetButtons.forEach((b, i) => {
        b.style.borderColor = (i === sceneIdx)
          ? 'var(--color-accent, #2a5fb8)' : '';
      });
    }

    function buildSceneThumbnail(sd, px) {
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
      const { circles, rects } = sd.make();
      cx.fillStyle = theme.neumannFill;
      cx.strokeStyle = theme.neumann;
      cx.lineWidth = 1;
      cx.setLineDash([3, 2]);
      const proj = (x, y) => [x * px, (1 - y) * px];
      for (const cc of circles) {
        const [sx, sy] = proj(cc.cx, cc.cy);
        cx.beginPath();
        cx.arc(sx, sy, cc.r * px, 0, Math.PI * 2);
        cx.fill(); cx.stroke();
      }
      for (const r of rects) {
        const [sx, sy] = proj(r.x0, r.y1);
        const w = (r.x1 - r.x0) * px;
        const h = (r.y1 - r.y0) * px;
        cx.fillRect(sx, sy, w, h);
        cx.strokeRect(sx, sy, w, h);
      }
      cx.setLineDash([]);
      return c;
    }

    if (sigmaLabel) sigmaLabel.textContent = sigmaBound.toFixed(2);
    rebuildScene();
    startPrecompute();
  }

  W.WoDS.interactivePoissonSolution = W.WoDS.lazyFigure(init);
})(window);
