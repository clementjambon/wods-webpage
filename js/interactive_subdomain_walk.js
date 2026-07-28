/* Walk on Spheres inside a subdomain — studio-only.
 *
 * Two-column layout, mirroring #subkernel / #binop:
 *   Left  — the full 12-obstacle decomposition on an n×n tile grid. Click
 *           a tile to pick a subdomain.
 *   Right — that tile remapped to the unit square: every edge (physical
 *           Dirichlet wall or artificial interface) is an absorbing exit,
 *           obstacles clipped to the tile stay Neumann. Click to drop the
 *           start point x; a Walk-on-Stars walk then loops from it, drawn
 *           with its true star-shaped step regions (the disk at each point
 *           clipped by the surrounding Neumann occluders) — the same
 *           rendering used in #i1. A speed slider controls the playback. */
(function (W) {
  const U = W.WoDS.util;
  const S = W.WoDS.solver;
  const Sc = W.WoDS.scenes;

  const MAX_DRAW_STEPS = 600; // hard cap on points animated per walk
  const STAR_SAMPLES = 72;    // angular samples per star-shaped step region

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const decompCanvas = root.querySelector('canvas[data-role="decomp"]');
    const walkCanvas = root.querySelector('canvas[data-role="walk"]');
    const tileSlider = root.querySelector('input[data-role="tiles"]');
    const tileLabel = root.querySelector('[data-role="tiles-label"]');
    const speedSlider = root.querySelector('input[data-role="speed"]');
    const speedLabel = root.querySelector('[data-role="speed-label"]');
    const newBtn = root.querySelector('[data-role="new"]');
    const playBtn = root.querySelector('[data-role="play"]');
    const starsCb = root.querySelector('input[data-role="stars"]');
    const toggle = root.querySelector('[data-role="solver-toggle"]');

    const W0 = 360, H0 = 360, PAD = 56, SQ = W0 - 2 * PAD;
    const dctx = U.fitCanvas(decompCanvas, W0, H0);
    const wctx = U.fitCanvas(walkCanvas, W0, H0);

    const baseScene = Sc.layout(12); // Dirichlet square + 12 Neumann rects
    let n = tileSlider ? parseInt(tileSlider.value) : 4;
    let sel = { i: Math.floor(n / 2), j: Math.floor(n / 2) };
    let solverMode = toggle ? toggle.querySelector('input:checked').value : 'wost';
    // Log-scaled speed: slider value is log10(speed). 30ms/step at 1×.
    let speed = speedSlider ? Math.pow(10, parseFloat(speedSlider.value)) : 1;
    let paused = false;
    let pauseAt = 0; // performance.now() when paused, to re-anchor t0 on resume
    let showStars = starsCb ? starsCb.checked : true;

    // Local (subdomain) scene fed to the solver, in unit coords — the tile
    // remapped to the unit square, obstacles clipped and kept Neumann, all
    // four edges absorbing Dirichlet.
    const localScene = {
      walls: [
        { x0: 0, y0: 1, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 1, y0: 0, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 1, y1: 0, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 0, y1: 1, kind: 'D', value: 0 },
      ],
      rects: [], circles: [], mode: solverMode,
    };

    const start = { x: 0.5, y: 0.5 }; // start point in local (unit) coords
    let activeWalk = null;

    // Both panes share this [0,1]^2 -> screen mapping.
    function toScreen(x, y) { return [PAD + x * SQ, PAD + (1 - y) * SQ]; }

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
      ensureStartOutside();
      activeWalk = null;
    }

    function pointInObstacle(x, y, slack) {
      slack = slack || 0;
      for (const r of localScene.rects) {
        if (x > r.x0 - slack && x < r.x1 + slack &&
            y > r.y0 - slack && y < r.y1 + slack) return true;
      }
      return false;
    }

    // Nudge the start out of any obstacle it fell into (spiral search),
    // matching #subkernel's ensureSourceOutside.
    function ensureStartOutside() {
      if (!pointInObstacle(start.x, start.y, 0.02)) {
        start.x = Math.max(0.04, Math.min(0.96, start.x));
        start.y = Math.max(0.04, Math.min(0.96, start.y));
        return;
      }
      for (let i = 0; i < 64; i++) {
        const ang = i * 2 * Math.PI / 64;
        for (let r = 0.05; r < 0.7; r += 0.04) {
          const x = start.x + Math.cos(ang) * r;
          const y = start.y + Math.sin(ang) * r;
          if (x < 0.04 || x > 0.96 || y < 0.04 || y > 0.96) continue;
          if (pointInObstacle(x, y, 0.02)) continue;
          start.x = x; start.y = y; return;
        }
      }
    }

    // ---- Star-shaped step region (matches #i1) ----------------------
    function computeStar(cx, cy, r) {
      const pts = new Array(STAR_SAMPLES);
      for (let k = 0; k < STAR_SAMPLES; k++) {
        const a = (k / STAR_SAMPLES) * Math.PI * 2;
        const vx = Math.cos(a), vy = Math.sin(a);
        const hit = S.rayHitNeumann(cx, cy, vx, vy, r, localScene);
        const t = Math.min(r, hit.t);
        pts[k] = [cx + vx * t, cy + vy * t];
      }
      return pts;
    }

    function traceStar(ctx, star) {
      const s0 = toScreen(star[0][0], star[0][1]);
      ctx.beginPath();
      ctx.moveTo(s0[0], s0[1]);
      for (let k = 1; k < star.length; k++) {
        const sk = toScreen(star[k][0], star[k][1]);
        ctx.lineTo(sk[0], sk[1]);
      }
      ctx.closePath();
    }

    // ---- Walk lifecycle ---------------------------------------------
    function startActiveWalk() {
      const r = S.walk(localScene, start.x, start.y, true);
      if (r.points && r.points.length > MAX_DRAW_STEPS) {
        r.points = r.points.slice(0, MAX_DRAW_STEPS);
        if (r.radii) r.radii = r.radii.slice(0, MAX_DRAW_STEPS);
      }
      const stars = [];
      if (r.points && r.radii) {
        const m = Math.min(r.radii.length, r.points.length - 1);
        for (let i = 0; i < m; i++) {
          const c = r.points[i], rad = r.radii[i];
          stars.push(rad * SQ >= 1 ? computeStar(c[0], c[1], rad) : null);
        }
      }
      activeWalk = { ...r, stars, pointsShown: 1, t0: performance.now() };
    }

    // ---- Rendering: left decomposition pane -------------------------
    function drawDecomp() {
      dctx.clearRect(0, 0, W0, H0);
      const { a, b, L } = tileBounds();
      const tl = toScreen(a, b + L);

      dctx.fillStyle = 'rgba(58,96,156,0.12)';
      dctx.fillRect(tl[0], tl[1], L * SQ, L * SQ);

      dctx.strokeStyle = theme.interface;
      dctx.lineWidth = 1.5;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        let p0 = toScreen(t, 0), p1 = toScreen(t, 1);
        dctx.beginPath(); dctx.moveTo(p0[0], p0[1]); dctx.lineTo(p1[0], p1[1]); dctx.stroke();
        p0 = toScreen(0, t); p1 = toScreen(1, t);
        dctx.beginPath(); dctx.moveTo(p0[0], p0[1]); dctx.lineTo(p1[0], p1[1]); dctx.stroke();
      }

      const o = toScreen(0, 1);
      dctx.lineWidth = 3; dctx.strokeStyle = theme.dirichlet;
      dctx.strokeRect(o[0], o[1], SQ, SQ);

      drawObstacles(dctx, baseScene.rects);

      dctx.lineWidth = 2.5; dctx.strokeStyle = theme.accent;
      dctx.strokeRect(tl[0], tl[1], L * SQ, L * SQ);
    }

    function drawObstacles(ctx, rects) {
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      for (const r of rects) {
        const p = toScreen(r.x0, r.y1);
        ctx.fillRect(p[0], p[1], (r.x1 - r.x0) * SQ, (r.y1 - r.y0) * SQ);
        ctx.strokeRect(p[0], p[1], (r.x1 - r.x0) * SQ, (r.y1 - r.y0) * SQ);
      }
      ctx.setLineDash([]);
    }

    // ---- Rendering: right subdomain / walk pane ---------------------
    function drawWalkPane() {
      wctx.clearRect(0, 0, W0, H0);

      // Outer absorbing square + clipped Neumann obstacles.
      const o = toScreen(0, 1);
      wctx.lineWidth = 3; wctx.strokeStyle = theme.dirichlet;
      wctx.strokeRect(o[0], o[1], SQ, SQ);
      drawObstacles(wctx, localScene.rects);

      if (activeWalk) drawWalk(activeWalk);
      drawStart();
    }

    function drawWalk(w) {
      if (!w || !w.points) return;
      const pts = w.points;
      const upTo = w.pointsShown;
      const growing = upTo < pts.length;

      wctx.save();

      if (showStars && w.stars) {
        wctx.fillStyle = theme.accent;
        wctx.strokeStyle = theme.accent;
        for (let i = 0; i < upTo - 1 && i < w.stars.length; i++) {
          const star = w.stars[i];
          if (!star) continue;
          traceStar(wctx, star);
          wctx.globalAlpha = 0.07; wctx.fill();
          wctx.globalAlpha = 0.28; wctx.lineWidth = 0.7; wctx.stroke();
        }
        if (growing && upTo - 1 < w.stars.length && w.stars[upTo - 1]) {
          traceStar(wctx, w.stars[upTo - 1]);
          wctx.globalAlpha = 0.12; wctx.fill();
          wctx.globalAlpha = 0.55; wctx.lineWidth = 1; wctx.stroke();
        }
      }

      wctx.globalAlpha = 1;
      wctx.strokeStyle = theme.walk;
      wctx.lineWidth = 1.4; wctx.lineJoin = 'round'; wctx.lineCap = 'round';
      wctx.beginPath();
      const p0 = toScreen(pts[0][0], pts[0][1]);
      wctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < upTo; i++) {
        const p = toScreen(pts[i][0], pts[i][1]);
        wctx.lineTo(p[0], p[1]);
      }
      wctx.stroke();

      const tip = toScreen(pts[upTo - 1][0], pts[upTo - 1][1]);
      wctx.fillStyle = theme.walk;
      wctx.beginPath(); wctx.arc(tip[0], tip[1], 3, 0, Math.PI * 2); wctx.fill();

      // Absorbed endpoint marker once the walk has fully played.
      if (!growing && w.kind !== 'X') {
        wctx.fillStyle = theme.accent;
        wctx.strokeStyle = theme.surface; wctx.lineWidth = 1.6;
        wctx.beginPath(); wctx.arc(tip[0], tip[1], 4, 0, Math.PI * 2);
        wctx.fill(); wctx.stroke();
      }
      wctx.restore();
    }

    function drawStart() {
      const s = toScreen(start.x, start.y);
      wctx.save();
      wctx.fillStyle = theme.walk;
      wctx.strokeStyle = theme.surface;
      wctx.lineWidth = 1.6;
      wctx.beginPath(); wctx.arc(s[0], s[1], 5, 0, Math.PI * 2);
      wctx.fill(); wctx.stroke();
      wctx.restore();
      // In-canvas italic "x" beside the start (captured by the video tool).
      wctx.save();
      wctx.textBaseline = 'middle'; wctx.textAlign = 'left';
      wctx.font = 'italic 20px KaTeX_Math, Georgia, "Times New Roman", serif';
      const lx = s[0] + 12 - wctx.measureText('x').width / 2, ly = s[1] - 11;
      wctx.fillStyle = theme.text;
      wctx.shadowColor = theme.surface; wctx.shadowBlur = 3;
      for (let k = 0; k < 3; k++) wctx.fillText('x', lx, ly);
      wctx.restore();
    }

    // ---- Frame loop --------------------------------------------------
    function frame(t) {
      if (!activeWalk && !paused) startActiveWalk();
      if (activeWalk && !paused) {
        const msPerStep = 30 / speed;
        const elapsed = Math.max(0, t - activeWalk.t0);
        const stepsToShow = Math.min(activeWalk.points.length,
                                     Math.max(1, 1 + Math.floor(elapsed / msPerStep)));
        activeWalk.pointsShown = stepsToShow;
        // Chain straight into the next walk once this one is fully drawn —
        // no dwell, so trajectories succeed each other continuously.
        if (stepsToShow >= activeWalk.points.length) { activeWalk = null; startActiveWalk(); }
      }
      drawDecomp();
      drawWalkPane();
    }

    // ---- Interaction -------------------------------------------------
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
      start.x = 0.5; start.y = 0.5; // reset to tile center
      rebuildLocalScene();
    });

    // Right: click/drag places the walk's start point.
    let dragging = false;
    function setStartFrom(e) {
      const [x, y] = evToScene(walkCanvas, e);
      start.x = Math.max(0.02, Math.min(0.98, x));
      start.y = Math.max(0.02, Math.min(0.98, y));
      ensureStartOutside();
      activeWalk = null;
    }
    walkCanvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { walkCanvas.setPointerCapture(e.pointerId); } catch (_) {}
      setStartFrom(e);
    });
    walkCanvas.addEventListener('pointermove', (e) => { if (dragging) setStartFrom(e); });
    walkCanvas.addEventListener('pointerup', () => { dragging = false; });
    walkCanvas.addEventListener('pointercancel', () => { dragging = false; });

    if (tileSlider) {
      tileSlider.addEventListener('input', () => {
        n = parseInt(tileSlider.value);
        if (tileLabel) tileLabel.textContent = `${n}×${n}`;
        sel.i = Math.min(n - 1, sel.i);
        sel.j = Math.min(n - 1, sel.j);
        start.x = 0.5; start.y = 0.5;
        rebuildLocalScene();
      });
    }
    if (speedSlider) {
      const upd = () => {
        speed = Math.pow(10, parseFloat(speedSlider.value));
        if (speedLabel) speedLabel.textContent = `${speed.toFixed(2)}×`;
      };
      speedSlider.addEventListener('input', upd);
      upd();
    }
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        if (e.target && e.target.name) {
          solverMode = e.target.value;
          localScene.mode = solverMode;
          activeWalk = null;
        }
      });
    }
    if (starsCb) starsCb.addEventListener('change', () => { showStars = starsCb.checked; });
    if (newBtn) newBtn.addEventListener('click', () => { activeWalk = null; });
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        paused = !paused;
        playBtn.textContent = paused ? '▶ Play' : '⏸ Pause';
        if (paused) {
          pauseAt = performance.now();
        } else if (activeWalk) {
          // Resume the reveal where it left off instead of replaying.
          activeWalk.t0 += performance.now() - pauseAt;
        }
      });
    }

    if (tileLabel) tileLabel.textContent = `${n}×${n}`;
    rebuildLocalScene();
    U.animLoop(root, frame);
  }

  W.WoDS.interactiveSubdomainWalk = W.WoDS.lazyFigure(init);
})(window);
