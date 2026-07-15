/* Manually-designed Walk on Stars inside a subdomain — studio-only.
 *
 * A sibling of #subwalk. Same two-column setup:
 *   Left  — the full 12-obstacle decomposition on an n×n tile grid. Click a
 *           tile to pick a subdomain.
 *   Right — that tile remapped to the unit square: every edge (physical
 *           Dirichlet wall or artificial interface) is an absorbing exit,
 *           obstacles clipped to the tile stay Neumann.
 *
 * But instead of simulating a random walk, you DESIGN one by hand. Click once
 * on the right to drop the start point x; its star-shaped step region appears.
 * Every subsequent click snaps to the boundary of the current star (the valid
 * set of next centers) and extends the trajectory, revealing the next star.
 * When a click lands on the outer Dirichlet boundary the walk is absorbed and
 * the trajectory ends.
 *
 * The right pane can be exported as an SVG (vector) via the same replay-the-
 * draw-calls trick as #ifstates: the figure points its ctx at an svgRecorder
 * and re-runs render(), so the vector can never drift from the on-screen one. */
(function (W) {
  const U = W.WoDS.util;
  const S = W.WoDS.solver;
  const Sc = W.WoDS.scenes;
  const C = W.WoDS.config;

  const STAR_SAMPLES = 96;   // angular samples per star-shaped step region
  const MAX_POINTS = 500;    // hard cap on hand-placed centers

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const decompCanvas = root.querySelector('canvas[data-role="decomp"]');
    const walkCanvas = root.querySelector('canvas[data-role="walk"]');
    const tileSlider = root.querySelector('input[data-role="tiles"]');
    const tileLabel = root.querySelector('[data-role="tiles-label"]');
    const starsCb = root.querySelector('input[data-role="stars"]');
    const toggle = root.querySelector('[data-role="solver-toggle"]');
    const undoBtn = root.querySelector('[data-role="undo"]');
    const resetBtn = root.querySelector('[data-role="reset"]');
    const exportSvgBtn = root.querySelector('button[data-role="export-svg"]');
    const statusLabel = root.querySelector('[data-role="status"]');

    const W0 = 360, H0 = 360, PAD = 56, SQ = W0 - 2 * PAD;
    const dctx = U.fitCanvas(decompCanvas, W0, H0);
    // Not const: SVG export swaps in a recorder with the same interface and
    // re-runs the right-pane render(), so there is only one drawing path.
    let wctx = U.fitCanvas(walkCanvas, W0, H0);

    const baseScene = Sc.layout(12); // Dirichlet square + 12 Neumann rects
    let n = tileSlider ? parseInt(tileSlider.value) : 4;
    let sel = { i: Math.floor(n / 2), j: Math.floor(n / 2) };
    let solverMode = toggle ? toggle.querySelector('input:checked').value : 'wost';
    let showStars = starsCb ? starsCb.checked : true;

    const eps = (C && C.epsilon != null) ? C.epsilon : 0.005;
    const rmin = (C && C.rmin != null) ? C.rmin : eps;
    const absorbEps = 0.02;   // click-to-absorb slack near the Dirichlet wall (~5px)

    // Local (subdomain) scene: the tile remapped to the unit square, obstacles
    // clipped and kept Neumann, all four edges absorbing Dirichlet.
    const localScene = {
      walls: [
        { x0: 0, y0: 1, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 1, y0: 0, x1: 1, y1: 1, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 1, y1: 0, kind: 'D', value: 0 },
        { x0: 0, y0: 0, x1: 0, y1: 1, kind: 'D', value: 0 },
      ],
      rects: [], circles: [], mode: solverMode,
    };

    // The hand-designed trajectory.
    let traj = [];     // centers, in local (unit) coords: [[x,y], ...]
    let stars = [];    // stars[i] = star polygon at traj[i] (null once absorbed)
    let absorbed = false;
    let hover = null;  // { pt:[x,y], willAbsorb } candidate for the next click

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
      clearTrajectory();
    }

    function clearTrajectory() {
      traj = []; stars = []; absorbed = false; hover = null;
      updateStatus();
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
    // matching #subwalk's ensureStartOutside.
    function nudgeOutside(p) {
      if (!pointInObstacle(p[0], p[1], 0.02)) {
        p[0] = Math.max(0.02, Math.min(0.98, p[0]));
        p[1] = Math.max(0.02, Math.min(0.98, p[1]));
        return p;
      }
      for (let i = 0; i < 64; i++) {
        const ang = i * 2 * Math.PI / 64;
        for (let r = 0.05; r < 0.7; r += 0.04) {
          const x = p[0] + Math.cos(ang) * r;
          const y = p[1] + Math.sin(ang) * r;
          if (x < 0.02 || x > 0.98 || y < 0.02 || y > 0.98) continue;
          if (pointInObstacle(x, y, 0.02)) continue;
          return [x, y];
        }
      }
      return p;
    }

    // ---- Step region -------------------------------------------------
    // Star radius, following the solver's rule for the active mode.
    function computeRadius(cx, cy) {
      const dD = S.distToDirichlet(cx, cy, localScene).dist;
      if (solverMode === 'wos') {
        const info = S.distToSegments(cx, cy, localScene);
        return Math.max(rmin, info.dist);
      }
      const dSil = S.silhouetteDist(cx, cy, localScene);
      return Math.max(rmin, Math.min(dD, dSil));
    }

    // Star-shaped step region (matches #i1 / #subwalk). In WoS the radius is
    // the distance to the nearest boundary of any kind, so no Neumann occluder
    // lies within r and the star collapses to a plain circle.
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

    function starAt(p) {
      return computeStar(p[0], p[1], computeRadius(p[0], p[1]));
    }

    // ---- Geometry: project onto the current star boundary -----------
    function projectToPolyline(px, py, poly) {
      let bestD = Infinity, best = poly[0];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const abx = b[0] - a[0], aby = b[1] - a[1];
        const len2 = abx * abx + aby * aby;
        let t = len2 > 0 ? ((px - a[0]) * abx + (py - a[1]) * aby) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = a[0] + t * abx, qy = a[1] + t * aby;
        const d = Math.hypot(px - qx, py - qy);
        if (d < bestD) { bestD = d; best = [qx, qy]; }
      }
      return best;
    }

    // Snap a point to the nearest outer (Dirichlet) wall, for a clean finish.
    function snapToDirichlet(p) {
      const dL = p[0], dR = 1 - p[0], dB = p[1], dT = 1 - p[1];
      const m = Math.min(dL, dR, dB, dT);
      if (m === dL) return [0, p[1]];
      if (m === dR) return [1, p[1]];
      if (m === dB) return [p[0], 0];
      return [p[0], 1];
    }

    // Candidate next center for a raw click/hover at (x,y): the closest point
    // on the current star's boundary, plus whether landing there absorbs.
    function candidateFrom(x, y) {
      const cur = stars[stars.length - 1];
      if (!cur) return null;
      let pt = projectToPolyline(x, y, cur);
      const dD = S.distToDirichlet(pt[0], pt[1], localScene).dist;
      const willAbsorb = dD < absorbEps;
      if (willAbsorb) pt = snapToDirichlet(pt);
      return { pt, willAbsorb };
    }

    // ---- Trajectory edits -------------------------------------------
    function placeStart(x, y) {
      const p = nudgeOutside([x, y]);
      traj = [p];
      stars = [starAt(p)];
      absorbed = false;
      hover = null;
      updateStatus();
    }

    function extend(cand) {
      if (!cand || absorbed || traj.length >= MAX_POINTS) return;
      traj.push(cand.pt);
      if (cand.willAbsorb) {
        absorbed = true;
        stars.push(null);
      } else {
        stars.push(starAt(cand.pt));
      }
      hover = null;
      updateStatus();
    }

    function undo() {
      if (traj.length === 0) return;
      traj.pop(); stars.pop();
      absorbed = false;
      hover = null;
      updateStatus();
    }

    function updateStatus() {
      if (!statusLabel) return;
      const centers = traj.length;
      const steps = Math.max(0, centers - 1);
      let msg;
      if (centers === 0) msg = 'Click on the right pane to place the start point x.';
      else if (absorbed) msg = `Absorbed after ${steps} step${steps === 1 ? '' : 's'}.`;
      else msg = `${steps} step${steps === 1 ? '' : 's'} · click the star boundary to add the next center.`;
      statusLabel.textContent = msg;
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

    // ---- Rendering: right subdomain / walk pane --------------------
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

    function renderWalk() {
      wctx.clearRect(0, 0, W0, H0);

      // Outer absorbing square + clipped Neumann obstacles.
      const o = toScreen(0, 1);
      wctx.lineWidth = 3; wctx.strokeStyle = theme.dirichlet;
      wctx.strokeRect(o[0], o[1], SQ, SQ);
      drawObstacles(wctx, localScene.rects);

      // Star-shaped step regions along the trajectory.
      if (showStars) {
        wctx.save();
        wctx.fillStyle = theme.accent;
        wctx.strokeStyle = theme.accent;
        for (let i = 0; i < stars.length; i++) {
          const star = stars[i];
          if (!star) continue;
          const active = (i === stars.length - 1) && !absorbed;
          traceStar(wctx, star);
          wctx.globalAlpha = active ? 0.12 : 0.07; wctx.fill();
          wctx.globalAlpha = active ? 0.55 : 0.28;
          wctx.lineWidth = active ? 1 : 0.7; wctx.stroke();
        }
        wctx.restore();
      }

      // Trajectory polyline + vertices.
      if (traj.length > 0) {
        wctx.save();
        wctx.globalAlpha = 1;
        wctx.strokeStyle = theme.walk;
        wctx.lineWidth = 1.4; wctx.lineJoin = 'round'; wctx.lineCap = 'round';
        if (traj.length > 1) {
          wctx.beginPath();
          const p0 = toScreen(traj[0][0], traj[0][1]);
          wctx.moveTo(p0[0], p0[1]);
          for (let i = 1; i < traj.length; i++) {
            const p = toScreen(traj[i][0], traj[i][1]);
            wctx.lineTo(p[0], p[1]);
          }
          wctx.stroke();
        }
        // Intermediate centers.
        wctx.fillStyle = theme.walk;
        for (let i = 1; i < traj.length - (absorbed ? 1 : 0); i++) {
          const p = toScreen(traj[i][0], traj[i][1]);
          wctx.beginPath(); wctx.arc(p[0], p[1], 3, 0, Math.PI * 2); wctx.fill();
        }
        wctx.restore();

        // Absorbed endpoint marker.
        if (absorbed) {
          const e = traj[traj.length - 1];
          const p = toScreen(e[0], e[1]);
          wctx.save();
          wctx.fillStyle = theme.accent;
          wctx.strokeStyle = theme.surface; wctx.lineWidth = 1.6;
          wctx.beginPath(); wctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
          wctx.fill(); wctx.stroke();
          wctx.restore();
        }

        drawStart();
      }

      // Hover candidate for the next click (screen-only, skipped on export).
      if (hover && wctx.fillText) {
        const p = toScreen(hover.pt[0], hover.pt[1]);
        wctx.save();
        wctx.fillStyle = hover.willAbsorb ? theme.accent : theme.surface;
        wctx.strokeStyle = theme.accent; wctx.lineWidth = 1.6;
        wctx.globalAlpha = 0.9;
        wctx.beginPath(); wctx.arc(p[0], p[1], 4.5, 0, Math.PI * 2);
        wctx.fill(); wctx.stroke();
        wctx.restore();
      }
    }

    function drawStart() {
      const s = toScreen(traj[0][0], traj[0][1]);
      wctx.save();
      wctx.fillStyle = theme.walk;
      wctx.strokeStyle = theme.surface;
      wctx.lineWidth = 1.6;
      wctx.beginPath(); wctx.arc(s[0], s[1], 5, 0, Math.PI * 2);
      wctx.fill(); wctx.stroke();
      wctx.restore();
      // In-canvas italic "x" beside the start. fillText is absent on the SVG
      // recorder, so the guard also keeps the label out of the vector export.
      if (wctx.fillText && wctx.measureText) {
        wctx.save();
        wctx.textBaseline = 'middle'; wctx.textAlign = 'left';
        wctx.font = 'italic 20px KaTeX_Math, Georgia, "Times New Roman", serif';
        const lx = s[0] + 12 - wctx.measureText('x').width / 2, ly = s[1] - 11;
        wctx.fillStyle = theme.text;
        wctx.shadowColor = theme.surface; wctx.shadowBlur = 3;
        for (let k = 0; k < 3; k++) wctx.fillText('x', lx, ly);
        wctx.restore();
      }
    }

    // ---- Frame loop --------------------------------------------------
    function frame() {
      drawDecomp();
      renderWalk();
    }

    // ---- Export ------------------------------------------------------
    function renderToSVG() {
      const rec = W.WoDS.svgRecorder(W0, H0);
      const live = wctx;
      const prevHover = hover;
      wctx = rec.ctx;
      hover = null;
      let svg;
      try {
        renderWalk();
        svg = rec.toSVG();
      } finally {
        wctx = live;
        hover = prevHover;
      }
      renderWalk();
      return svg;
    }

    function download(url, name, revoke) {
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // ---- Interaction -------------------------------------------------
    function evToScene(canvasEl, e) {
      const r = canvasEl.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width * W0;
      const cy = (e.clientY - r.top) / r.height * H0;
      return [(cx - PAD) / SQ, 1 - (cy - PAD) / SQ];
    }

    // Left: click selects a tile (resets the design).
    decompCanvas.addEventListener('pointerdown', (e) => {
      const [x, y] = evToScene(decompCanvas, e);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      sel = {
        i: Math.min(n - 1, Math.max(0, Math.floor(x * n))),
        j: Math.min(n - 1, Math.max(0, Math.floor(y * n))),
      };
      rebuildLocalScene();
    });

    // Right: first click places x; each later click extends along the star.
    walkCanvas.addEventListener('pointerdown', (e) => {
      const [x, y] = evToScene(walkCanvas, e);
      if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return;
      if (traj.length === 0) {
        placeStart(Math.max(0.02, Math.min(0.98, x)), Math.max(0.02, Math.min(0.98, y)));
      } else if (!absorbed) {
        extend(candidateFrom(x, y));
      }
    });

    walkCanvas.addEventListener('pointermove', (e) => {
      if (traj.length === 0 || absorbed) { hover = null; return; }
      const [x, y] = evToScene(walkCanvas, e);
      hover = candidateFrom(x, y);
    });
    walkCanvas.addEventListener('pointerleave', () => { hover = null; });

    if (tileSlider) {
      tileSlider.addEventListener('input', () => {
        n = parseInt(tileSlider.value);
        if (tileLabel) tileLabel.textContent = `${n}×${n}`;
        sel.i = Math.min(n - 1, sel.i);
        sel.j = Math.min(n - 1, sel.j);
        rebuildLocalScene();
      });
    }
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        if (e.target && e.target.name) {
          solverMode = e.target.value;
          localScene.mode = solverMode;
          clearTrajectory();
        }
      });
    }
    if (starsCb) starsCb.addEventListener('change', () => { showStars = starsCb.checked; });
    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (resetBtn) resetBtn.addEventListener('click', clearTrajectory);
    if (exportSvgBtn) {
      exportSvgBtn.addEventListener('click', () => {
        const blob = new Blob([renderToSVG()], { type: 'image/svg+xml;charset=utf-8' });
        download(URL.createObjectURL(blob), `manual-walk-${sel.i}-${sel.j}-of-${n}.svg`, true);
      });
    }

    if (tileLabel) tileLabel.textContent = `${n}×${n}`;
    rebuildLocalScene();
    U.animLoop(root, frame);
  }

  W.WoDS.interactiveManualWalk = W.WoDS.lazyFigure(init);
})(window);
