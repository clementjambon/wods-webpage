/* Interactive 3 — the Poisson kernel P(x, z).
 *
 * Inside a single 1×1 tile with a Neumann obstacle, we pick an
 * interior source point x (draggable). The Poisson kernel P(x, ·)
 * is the first-passage distribution on ∂Ω_D — i.e. for each
 * boundary location z, the probability density that a Brownian
 * walk from x exits there. We estimate it by Monte Carlo: run
 * many walks from x, bin the exit points along the perimeter, and
 * draw a perpendicular bar at each bin scaled by mass.
 *
 * The Neumann obstacle can be dragged (translates the whole shape
 * group), resized via the slider, and swapped between several
 * shape presets — the kernel re-estimates on every change so you
 * can see how the geometry reshapes the exit distribution.
 */
(function (W) {
  const U = W.WoDS.util;
  const S = W.WoDS.solver;

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const canvas = root.querySelector('canvas.diagram');
    const recomputeBtn = root.querySelector('button[data-role="recompute"]');
    const statusLabel = root.querySelector('[data-role="status"]');
    const paramsDiv = root.querySelector('[data-role="shape-params"]');

    const W0 = 480, H0 = 480;
    const ctx = U.fitCanvas(canvas, W0, H0);
    // Inset the unit square so the outward Poisson-kernel bars have room.
    const PAD = 70;
    const SQ = W0 - 2 * PAD;

    // KaTeX-rendered "x" overlay positioned over the canvas. Canvas can't
    // host KaTeX, so we render once into an absolutely-positioned span and
    // move it on every render() / resize.
    const labelParent = canvas.parentNode;
    if (getComputedStyle(labelParent).position === 'static') {
      labelParent.style.position = 'relative';
    }
    const xLabel = document.createElement('span');
    xLabel.style.cssText =
      'position:absolute; pointer-events:none; transform:translate(-50%,-50%);' +
      ' white-space:nowrap; font-size:16px;' +
      ' filter:drop-shadow(0 0 2px var(--color-surface))' +
      ' drop-shadow(0 0 2px var(--color-surface))' +
      ' drop-shadow(0 0 2px var(--color-surface));';
    labelParent.appendChild(xLabel);
    if (W.katex) {
      W.katex.render('x', xLabel, { throwOnError: false });
    } else {
      xLabel.textContent = 'x';
      xLabel.style.fontStyle = 'italic';
    }
    function updateXLabel() {
      const sp = toScreen(source.x, source.y);
      const cw = canvas.clientWidth || W0;
      const ch = canvas.clientHeight || H0;
      // Match the original offset (lx=sp[0]+11, ly=sp[1]-9, baseline middle,
      // textAlign start) — glyph center roughly +15.5px right, -9px up.
      xLabel.style.left =
        (canvas.offsetLeft + (sp[0] + 15.5) / W0 * cw) + 'px';
      xLabel.style.top  =
        (canvas.offsetTop  + (sp[1] - 9)    / H0 * ch) + 'px';
    }
    window.addEventListener('resize', () => updateXLabel());

    // Obstacle presets. Each preset declares its own `params` (with min,
    // max, step, default) and a `make(p)` that returns base obstacles in
    // unit-square coords centered around (0.5, 0.5). They get translated
    // by `obstacleOffset` for dragging.
    const presets = [
      {
        name: 'Circle',
        params: [
          { key: 'r', label: 'radius', min: 0.04, max: 0.32, step: 0.005, def: 0.18 },
        ],
        make: (p) => ({
          circles: [{ cx: 0.5, cy: 0.5, r: p.r, kind: 'N' }],
          rects: [],
        }),
      },
      {
        name: 'Square',
        params: [
          { key: 'w', label: 'width',  min: 0.06, max: 0.7, step: 0.01, def: 0.36 },
          { key: 'h', label: 'height', min: 0.06, max: 0.7, step: 0.01, def: 0.36 },
        ],
        make: (p) => ({
          circles: [],
          rects: [{
            x0: 0.5 - p.w / 2, y0: 0.5 - p.h / 2,
            x1: 0.5 + p.w / 2, y1: 0.5 + p.h / 2, kind: 'N',
          }],
        }),
      },
      {
        name: 'L-shape',
        params: [
          { key: 'len',   label: 'arm length', min: 0.16, max: 0.7,  step: 0.01,  def: 0.45 },
          { key: 'thick', label: 'thickness',  min: 0.03, max: 0.18, step: 0.005, def: 0.10 },
        ],
        make: (p) => {
          // Two rects sharing the bottom-right corner. Centered roughly on
          // the L's interior, with the elbow placed near (0.5, 0.5).
          const cx = 0.5, cy = 0.5;
          const t = p.thick, L = p.len;
          // Horizontal arm spans the bottom; vertical arm goes up the right.
          return {
            circles: [],
            rects: [
              { x0: cx - L / 2,        y0: cy - t / 2,
                x1: cx + L / 2,        y1: cy + t / 2, kind: 'N' },
              { x0: cx + L / 2 - t,    y0: cy - t / 2,
                x1: cx + L / 2,        y1: cy - t / 2 + L, kind: 'N' },
            ],
          };
        },
      },
      {
        name: 'Cross',
        params: [
          { key: 'len',   label: 'arm length', min: 0.16, max: 0.7,  step: 0.01,  def: 0.45 },
          { key: 'thick', label: 'thickness',  min: 0.03, max: 0.18, step: 0.005, def: 0.10 },
        ],
        make: (p) => {
          const t = p.thick, L = p.len;
          return {
            circles: [],
            rects: [
              { x0: 0.5 - L / 2, y0: 0.5 - t / 2,
                x1: 0.5 + L / 2, y1: 0.5 + t / 2, kind: 'N' },
              { x0: 0.5 - t / 2, y0: 0.5 - L / 2,
                x1: 0.5 + t / 2, y1: 0.5 + L / 2, kind: 'N' },
            ],
          };
        },
      },
      {
        name: 'Spiral',
        params: [
          { key: 'turns', label: 'turns',       min: 1.0,  max: 3.0,  step: 0.1,   def: 1.8 },
          { key: 'bead',  label: 'bead radius', min: 0.02, max: 0.05, step: 0.002, def: 0.035 },
        ],
        make: (p) => {
          // Archimedean spiral r(θ) = a + b·θ, sampled densely enough that
          // consecutive beads overlap into a continuous tube. Step in θ
          // adapts to local radius so spacing in arc-length stays uniform.
          const circles = [];
          const Tmax = p.turns * 2 * Math.PI;
          const a = 0.025;
          // Pick b so the outer radius reaches ~0.34 at theta = Tmax.
          const b = (0.34 - a) / Math.max(Tmax, 1e-3);
          const ds = p.bead * 0.7;
          let theta = 0;
          while (theta <= Tmax) {
            const r = a + b * theta;
            circles.push({
              cx: 0.5 + r * Math.cos(theta),
              cy: 0.5 + r * Math.sin(theta),
              r: p.bead, kind: 'N',
            });
            // Δs ≈ sqrt((dr)^2 + (r·dθ)^2) ≈ r·dθ for small steps. Keep dθ
            // bounded below so we don't loop forever near the origin.
            theta += Math.max(0.08, ds / Math.max(r, 0.025));
          }
          return { circles, rects: [] };
        },
      },
      {
        name: 'None',
        params: [],
        make: () => ({ circles: [], rects: [] }),
      },
    ];

    let presetIdx = 0;
    let currentParams = {};
    let obstacleOffset = [0, 0]; // applied on top of base layout

    function loadDefaultParams() {
      currentParams = {};
      for (const pp of presets[presetIdx].params) currentParams[pp.key] = pp.def;
    }
    loadDefaultParams();

    // Scene: unit square with current obstacle layout.
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

    function rebuildObstacles() {
      const { circles, rects } = presets[presetIdx].make(currentParams);
      const [ox, oy] = obstacleOffset;
      scene.circles = circles.map(c => ({ ...c, cx: c.cx + ox, cy: c.cy + oy }));
      scene.rects = rects.map(r => ({
        ...r, x0: r.x0 + ox, y0: r.y0 + oy, x1: r.x1 + ox, y1: r.y1 + oy
      }));
    }

    function rebuildParamControls() {
      if (!paramsDiv) return;
      paramsDiv.innerHTML = '';
      for (const pp of presets[presetIdx].params) {
        const wrap = document.createElement('div');
        wrap.style.marginBottom = '8px';
        wrap.innerHTML = `
          <div style="display:flex; justify-content:space-between; font-size:0.78rem;">
            <span>${pp.label}</span><span data-val>${currentParams[pp.key].toFixed(3)}</span>
          </div>
          <input type="range" min="${pp.min}" max="${pp.max}" step="${pp.step}"
                 value="${currentParams[pp.key]}">
        `;
        const input = wrap.querySelector('input');
        const valSpan = wrap.querySelector('[data-val]');
        input.addEventListener('input', () => {
          currentParams[pp.key] = parseFloat(input.value);
          valSpan.textContent = currentParams[pp.key].toFixed(3);
          rebuildObstacles();
          ensureSourceOutsideObstacle();
          resetEstimate();
        });
        paramsDiv.appendChild(wrap);
      }
    }

    const toggle = root.querySelector('[data-role="solver-toggle"]');
    if (toggle) {
      scene.mode = toggle.querySelector('input:checked').value;
      toggle.addEventListener('change', (e) => {
        if (e.target && e.target.name) {
          scene.mode = e.target.value;
          resetEstimate();
        }
      });
    }

    // Source point (interior). Default placed below the obstacle.
    const source = { x: 0.5, y: 0.15 };

    // Boundary bins around the perimeter (length 4 in scene coords).
    const NBINS = 96;
    let prob = new Float32Array(NBINS); // estimated probability mass per bin
    let totalSamples = 0;

    function clearBins() {
      prob.fill(0);
      totalSamples = 0;
    }

    function paramOnPerimeter(x, y) {
      // Map a boundary point on the unit-square perimeter to s ∈ [0, 4).
      // Edges: 0..1 bottom (y=0, x in 0..1)
      //        1..2 right  (x=1, y in 0..1)
      //        2..3 top    (y=1, x in 1..0)
      //        3..4 left   (x=0, y in 1..0)
      const eps = 0.02;
      // Snap to whichever edge it's closest to.
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
      // Inverse of paramOnPerimeter — returns [x, y, nx, ny] (outward normal).
      s = ((s % 4) + 4) % 4;
      if (s < 1)      return [s,         0,           0, -1];
      if (s < 2)      return [1,         s - 1,       1,  0];
      if (s < 3)      return [3 - s,     1,           0,  1];
      return            [0,         4 - s,      -1,  0];
    }

    function pointInObstacle(x, y, slack) {
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

    function ensureSourceOutsideObstacle() {
      // Push the source out of any obstacle along a small spiral search.
      // (Cheap and good enough — obstacles are convex or nearly so here.)
      if (!pointInObstacle(source.x, source.y, 0.02)) {
        source.x = Math.max(0.02, Math.min(0.98, source.x));
        source.y = Math.max(0.02, Math.min(0.98, source.y));
        return;
      }
      let bestD = -1, bestX = source.x, bestY = source.y;
      for (let i = 0; i < 64; i++) {
        const a = i * 2 * Math.PI / 64;
        for (let r = 0.05; r < 0.6; r += 0.04) {
          const x = source.x + Math.cos(a) * r;
          const y = source.y + Math.sin(a) * r;
          if (x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98) continue;
          if (pointInObstacle(x, y, 0.02)) continue;
          if (bestD < 0 || r < bestD) { bestD = r; bestX = x; bestY = y; }
          break;
        }
      }
      source.x = bestX; source.y = bestY;
    }

    let estimating = false;
    let raf = 0;

    function resetEstimate() {
      clearBins();
      cancelAnimationFrame(raf);
      estimating = true;
      runChunk();
    }

    const TARGET_SAMPLES = 8000;
    const CHUNK_BUDGET_MS = 25;

    function runChunk() {
      if (!estimating) return;
      const t0 = performance.now();
      let n = 0;
      while (totalSamples < TARGET_SAMPLES && performance.now() - t0 < CHUNK_BUDGET_MS) {
        const r = S.walk(scene, source.x, source.y, false);
        if (r.kind === 'D') {
          const s = paramOnPerimeter(r.endX, r.endY);
          const b = Math.min(NBINS - 1, Math.max(0, Math.floor(s / 4 * NBINS)));
          prob[b] += 1;
        }
        totalSamples++;
        n++;
      }
      statusLabel.textContent =
        `P(x, ·) — samples: ${totalSamples}${totalSamples < TARGET_SAMPLES ? ' …' : ''}`;
      render();
      if (totalSamples < TARGET_SAMPLES) {
        raf = requestAnimationFrame(runChunk);
      } else {
        estimating = false;
      }
    }

    function moreSamples() {
      // Add another batch on top of what we already have.
      estimating = true;
      // bump target to allow another batch
      const more = 8000;
      const cap = totalSamples + more;
      const t0 = performance.now();
      function chunk() {
        if (!estimating) return;
        const t = performance.now();
        while (totalSamples < cap && performance.now() - t < CHUNK_BUDGET_MS) {
          const r = S.walk(scene, source.x, source.y, false);
          if (r.kind === 'D') {
            const s = paramOnPerimeter(r.endX, r.endY);
            const b = Math.min(NBINS - 1, Math.max(0, Math.floor(s / 4 * NBINS)));
            prob[b] += 1;
          }
          totalSamples++;
        }
        statusLabel.textContent = `P(x, ·) — samples: ${totalSamples}${totalSamples < cap ? ' …' : ''}`;
        render();
        if (totalSamples < cap) raf = requestAnimationFrame(chunk);
        else estimating = false;
      }
      raf = requestAnimationFrame(chunk);
    }

    function toScreen(x, y) { return [PAD + x * SQ, PAD + (1 - y) * SQ]; }

    function render() {
      ctx.clearRect(0, 0, W0, H0);

      // Outer Dirichlet square
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.dirichlet;
      ctx.strokeRect(PAD + 0.5, PAD + 0.5, SQ - 1, SQ - 1);

      // Obstacles
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
        const w = (r.x1 - r.x0) * SQ;
        const h = (r.y1 - r.y0) * SQ;
        ctx.fillRect(tl[0], tl[1], w, h);
        ctx.strokeRect(tl[0], tl[1], w, h);
      }
      ctx.setLineDash([]);

      // Poisson kernel bars along the perimeter.
      // Convert per-bin probability mass to a density per unit length and
      // scale to bar pixels. Bin width in scene units is 4/NBINS. The density
      // is mass / binWidth / N. We then map to a bar length in pixels.
      const N = Math.max(1, totalSamples);
      const binWidthScene = 4 / NBINS;
      let maxDensity = 0;
      const density = new Float32Array(NBINS);
      for (let b = 0; b < NBINS; b++) {
        density[b] = (prob[b] / N) / binWidthScene;
        if (density[b] > maxDensity) maxDensity = density[b];
      }
      const targetMax = PAD - 12; // px — leave a small gap inside the canvas edge
      const barScale = maxDensity > 0 ? targetMax / maxDensity : 0;
      const BAR_GAP = 2; // px the bar base sits outside the boundary stroke

      for (let b = 0; b < NBINS; b++) {
        const sMid = (b + 0.5) / NBINS * 4;
        const [x, y, nx, ny] = perimeterToXY(sMid);
        const [px, py] = toScreen(x, y);
        // Outward in screen space: x stays, y flips.
        const sNx = nx, sNy = -ny;
        const len = density[b] * barScale;
        if (len < 0.5) continue;
        const t = Math.min(1, density[b] / Math.max(maxDensity, 1e-9));
        // Color via the cool (blue) half of the theme colormap.
        ctx.fillStyle = U.colormap(0.5 - 0.5 * t, theme);
        ctx.strokeStyle = theme.dirichlet;
        ctx.lineWidth = 1;
        // Bar thickness in pixels: each perimeter bin spans 4/NBINS scene
        // units, which projects to 4*SQ/NBINS pixels along the edge.
        const wPx = (4 * SQ / NBINS) * 0.95;
        // Rectangle starting just outside the boundary stroke (offset by
        // BAR_GAP along the outward normal so it doesn't overlap the line)
        // and extending outward by len, perpendicular to the edge tangent.
        const tx = -sNy, ty = sNx;
        const halfW = wPx * 0.5;
        const bx = px + sNx * BAR_GAP, by = py + sNy * BAR_GAP;
        ctx.beginPath();
        ctx.moveTo(bx - tx * halfW, by - ty * halfW);
        ctx.lineTo(bx + tx * halfW, by + ty * halfW);
        ctx.lineTo(bx + tx * halfW + sNx * len, by + ty * halfW + sNy * len);
        ctx.lineTo(bx - tx * halfW + sNx * len, by - ty * halfW + sNy * len);
        ctx.closePath();
        ctx.fill();
      }

      // Source point disk (style matches interactive 1's pinned-origin marker).
      const sp = toScreen(source.x, source.y);
      ctx.save();
      ctx.fillStyle = theme.walk;
      ctx.strokeStyle = theme.bg || '#fff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(sp[0], sp[1], 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // "x" label is rendered as KaTeX in an HTML overlay (see updateXLabel).
      updateXLabel();
    }

    // ---- Interaction --------------------------------------------------

    let dragging = null; // 'source' | 'circle' | null
    let dragOff = [0, 0];

    function evToScene(e) {
      // Invert toScreen: the unit square only occupies the inset region
      // [PAD, W0-PAD] × [PAD, H0-PAD]. r.width/r.height correspond to W0/H0
      // in CSS pixels, so scale to those first.
      const r = canvas.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width  * W0;
      const cy = (e.clientY - r.top)  / r.height * H0;
      const x = (cx - PAD) / SQ;
      const y = 1 - (cy - PAD) / SQ;
      return [x, y];
    }

    function obstacleBounds() {
      // Bounding box of the current obstacle group, used to clamp drag.
      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (const c of scene.circles) {
        lo[0] = Math.min(lo[0], c.cx - c.r); lo[1] = Math.min(lo[1], c.cy - c.r);
        hi[0] = Math.max(hi[0], c.cx + c.r); hi[1] = Math.max(hi[1], c.cy + c.r);
      }
      for (const r of scene.rects) {
        lo[0] = Math.min(lo[0], r.x0); lo[1] = Math.min(lo[1], r.y0);
        hi[0] = Math.max(hi[0], r.x1); hi[1] = Math.max(hi[1], r.y1);
      }
      return { lo, hi };
    }

    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = evToScene(e);
      const dSrc = Math.hypot(x - source.x, y - source.y);
      // Prefer source if close.
      if (dSrc < 0.05) {
        dragging = 'source';
      } else if (pointInObstacle(x, y, 0)) {
        // Translate the whole obstacle group; remember the cursor offset
        // relative to the current obstacleOffset so dragging is sticky.
        dragging = 'obstacle';
        dragOff = [x - obstacleOffset[0], y - obstacleOffset[1]];
      } else {
        // Click on empty interior pins the source there and begins a drag.
        if (x > 0.02 && x < 0.98 && y > 0.02 && y < 0.98 &&
            !pointInObstacle(x, y, 0.02)) {
          source.x = x; source.y = y;
          ensureSourceOutsideObstacle();
          dragging = 'source';
          resetEstimate();
        } else {
          return;
        }
      }
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const [x, y] = evToScene(e);
      if (dragging === 'source') {
        source.x = Math.max(0.02, Math.min(0.98, x));
        source.y = Math.max(0.02, Math.min(0.98, y));
        ensureSourceOutsideObstacle();
        resetEstimate();
      } else if (dragging === 'obstacle') {
        // Compute proposed offset, then clamp so the obstacle stays inside
        // the unit square.
        const proposed = [x - dragOff[0], y - dragOff[1]];
        const prevOff = obstacleOffset;
        obstacleOffset = proposed;
        rebuildObstacles();
        const { lo, hi } = obstacleBounds();
        const margin = 0.01;
        let dx = 0, dy = 0;
        if (lo[0] < margin)     dx = margin - lo[0];
        if (hi[0] > 1 - margin) dx = (1 - margin) - hi[0];
        if (lo[1] < margin)     dy = margin - lo[1];
        if (hi[1] > 1 - margin) dy = (1 - margin) - hi[1];
        if (dx !== 0 || dy !== 0) {
          obstacleOffset = [proposed[0] + dx, proposed[1] + dy];
          rebuildObstacles();
        }
        ensureSourceOutsideObstacle();
        resetEstimate();
      }
    });

    canvas.addEventListener('pointerup', () => { dragging = null; });
    canvas.addEventListener('pointercancel', () => { dragging = null; });

    if (recomputeBtn) recomputeBtn.addEventListener('click', moreSamples);

    // Shape preset thumbnails — small canvases drawn the same way as the
    // main diagram, scaled down. Highlights the active preset.
    const presetsDiv = root.querySelector('[data-role="shape-presets"]');
    const presetButtons = [];
    if (presetsDiv) {
      presets.forEach((p, idx) => {
        const b = document.createElement('button');
        b.title = p.name;
        b.appendChild(buildShapeThumbnail(p, 40));
        b.addEventListener('click', () => {
          presetIdx = idx;
          obstacleOffset = [0, 0];
          loadDefaultParams();
          rebuildParamControls();
          rebuildObstacles();
          ensureSourceOutsideObstacle();
          updatePresetHighlight();
          resetEstimate();
        });
        presetsDiv.appendChild(b);
        presetButtons.push(b);
      });
      updatePresetHighlight();
    }

    function updatePresetHighlight() {
      presetButtons.forEach((b, i) => {
        b.style.borderColor = (i === presetIdx)
          ? 'var(--color-accent, #2a5fb8)' : '';
      });
    }

    function buildShapeThumbnail(preset, px) {
      const c = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      c.width = px * dpr; c.height = px * dpr;
      c.style.width = px + 'px'; c.style.height = px + 'px';
      const cx = c.getContext('2d');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Background
      cx.fillStyle = theme.surface;
      cx.fillRect(0, 0, px, px);
      cx.strokeStyle = theme.dirichlet;
      cx.lineWidth = 1.5;
      cx.strokeRect(1, 1, px - 2, px - 2);
      // Obstacles at preview-default params (each preset's defaults).
      const previewParams = {};
      for (const pp of preset.params) previewParams[pp.key] = pp.def;
      const { circles, rects } = preset.make(previewParams);
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

    // Studio-only: export just the scene boundaries (outer Dirichlet
    // square + Neumann obstacles) as a standalone SVG — no Poisson-kernel
    // bars, no source x. Mirrors render()'s geometry into vector form.
    if (document.body.classList.contains('studio')) {
      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.textContent = 'Export scene SVG';
      exportBtn.style.marginTop = '10px';
      (recomputeBtn ? recomputeBtn.parentNode : root).appendChild(exportBtn);
      exportBtn.addEventListener('click', exportSceneSVG);
    }

    // Split a CSS color (hex or rgba) into a solid color + opacity, since
    // some SVG consumers (e.g. Illustrator) don't parse rgba() fills.
    function svgPaint(col) {
      const m = /rgba?\(([^)]+)\)/.exec(col);
      if (m) {
        const p = m[1].split(',').map((s) => s.trim());
        return { color: `rgb(${p[0]},${p[1]},${p[2]})`,
                 opacity: p.length > 3 ? parseFloat(p[3]) : 1 };
      }
      return { color: col, opacity: 1 };
    }

    function exportSceneSVG() {
      const P = 6;            // padding so the square's stroke isn't clipped
      const S = SQ;          // square side in px (matches the canvas)
      const dim = S + 2 * P;
      const map = (x, y) => [P + x * S, P + (1 - y) * S];
      const fill = svgPaint(theme.neumannFill);
      const stroke = svgPaint(theme.neumann);
      const dir = svgPaint(theme.dirichlet);
      const out = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}">`,
        `<rect x="${P}" y="${P}" width="${S}" height="${S}" fill="none" ` +
          `stroke="${dir.color}" stroke-opacity="${dir.opacity}" stroke-width="3"/>`,
      ];
      const obst = (geom) =>
        `${geom} fill="${fill.color}" fill-opacity="${fill.opacity}" ` +
        `stroke="${stroke.color}" stroke-opacity="${stroke.opacity}" ` +
        `stroke-width="2" stroke-dasharray="5,4"/>`;
      for (const c of scene.circles) {
        const [cx, cy] = map(c.cx, c.cy);
        out.push(obst(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(c.r * S).toFixed(2)}"`));
      }
      for (const r of scene.rects) {
        const [x, y] = map(r.x0, r.y1);
        out.push(obst(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
          `width="${((r.x1 - r.x0) * S).toFixed(2)}" height="${((r.y1 - r.y0) * S).toFixed(2)}"`));
      }
      out.push('</svg>');
      const blob = new Blob([out.join('\n')], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'i3-scene.svg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    rebuildParamControls();
    rebuildObstacles();
    ensureSourceOutsideObstacle();
    render();
    resetEstimate();
  }

  W.WoDS.interactivePoissonKernel = W.WoDS.lazyFigure(init);
})(window);
