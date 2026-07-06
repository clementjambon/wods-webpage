/* Interactive 2 — tile-size slider with WoSt-style sphere overlays.
 *
 * Same hard scene as I1's worst case (12 obstacles). Adding tile
 * interfaces shortens walks dramatically; the histogram collapses
 * leftward. Walks terminate at any tile interface (kind='I',
 * absorbing for visualisation).
 *
 * Visualisation: a few walks are animated with their full sphere
 * sequence rendered as low-opacity disks (Sawhney's WoSt videos).
 * Past walks fade as a "ghost" layer so the user sees how short
 * the typical walk gets as tile resolution increases. */
(function (W) {
  const U = W.WoDS.util;
  const S = W.WoDS.solver;
  const Sc = W.WoDS.scenes;
  const C = W.WoDS.config;

  const STAR_SAMPLES = 72; // angular samples per star-shaped step region

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const canvas = root.querySelector('canvas.diagram');
    const histCanvas = root.querySelector('canvas.hist');
    const tileSlider = root.querySelector('input[data-role="tiles"]');
    const tileLabel = root.querySelector('[data-role="tiles-label"]');
    const avgLabel = root.querySelector('[data-role="avg"]');
    const resetBtn = root.querySelector('button[data-role="reset"]');
    // Studio-only controls (hidden on the public page). Looked up only in the
    // studio so the public figure keeps its original minimal behavior: 1×
    // speed, interfaces and walks always shown.
    const STUDIO = W.WoDS.inStudio;
    const speedSlider = STUDIO ? root.querySelector('input[data-role="speed"]') : null;
    const speedLabel = STUDIO ? root.querySelector('[data-role="speed-label"]') : null;

    const W0 = 380, H0 = 380;
    const ctx = U.fitCanvas(canvas, W0, H0);
    const HW = 240, HH = 160;
    const hctx = U.fitCanvas(histCanvas, HW, HH);

    const toggle = root.querySelector('[data-role="solver-toggle"]');
    let solverMode = toggle ? (toggle.querySelector('input:checked').value) : 'wost';

    const showIfaceCb = STUDIO ? root.querySelector('input[data-role="show-interfaces"]') : null;
    const showWalksCb = STUDIO ? root.querySelector('input[data-role="show-walks"]') : null;
    let showInterfaces = showIfaceCb ? showIfaceCb.checked : true;
    let showWalks = showWalksCb ? showWalksCb.checked : true;
    // Animation speed multiplier (1 = baseline 18ms/step). The slider is
    // log-scaled: its value is log10(speed), so speed = 10^value.
    let speed = speedSlider ? Math.pow(10, parseFloat(speedSlider.value)) : 1;
    // Animated reveal of the interface grid, eased toward showInterfaces.
    let ifaceReveal = showInterfaces ? 1 : 0;

    const baseScene = Sc.layout(12);
    let scene = withTiles(parseInt(tileSlider.value));
    let history = [];

    // Animated walks (with point + sphere chain)
    let activeWalks = [];   // currently-animating walks
    let ghostWalks = [];    // recent finished walks, fading

    function withTiles(n) {
      return {
        walls: baseScene.walls,
        rects: baseScene.rects,
        tileInterfaces: n > 1 ? Sc.tileInterfaces(n) : [],
        mode: solverMode,
      };
    }

    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

    function drawScene() {
      ctx.clearRect(0,0,W0,H0);

      // Tile grid. Reveal is animated: each line both fades in and
      // grows outward from its midpoint, staggered by index so the grid
      // cascades into place rather than popping on all at once.
      const ifaces = scene.tileInterfaces;
      if (ifaces && ifaces.length > 0 && ifaceReveal > 0.001) {
        ctx.strokeStyle = theme.interface;
        ctx.lineWidth = 1.5;
        const n = ifaces.length;
        const STAGGER = 0.5; // fraction of the timeline spread across lines
        for (let i = 0; i < n; i++) {
          const t = ifaces[i];
          // Per-line progress, delayed by its index then eased.
          const delay = n > 1 ? STAGGER * (i / (n - 1)) : 0;
          const span = 1 - STAGGER;
          let p = (ifaceReveal - delay) / (span || 1);
          p = p < 0 ? 0 : p > 1 ? 1 : p;
          const e = easeOut(p);
          if (e <= 0.001) continue;
          const ax = t.x0*W0, ay = (1-t.y0)*H0, bx = t.x1*W0, by = (1-t.y1)*H0;
          const cx = (ax+bx)/2, cy = (ay+by)/2;
          ctx.globalAlpha = 0.5 * e;
          ctx.beginPath();
          ctx.moveTo(cx + (ax-cx)*e, cy + (ay-cy)*e);
          ctx.lineTo(cx + (bx-cx)*e, cy + (by-cy)*e);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Outer Dirichlet
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.dirichlet;
      ctx.strokeRect(1.5, 1.5, W0-3, H0-3);

      // Neumann obstacles
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5,4]);
      ctx.strokeStyle = theme.neumann;
      ctx.fillStyle = theme.neumannFill;
      for (const r of scene.rects) {
        const x = r.x0*W0, y = (1-r.y1)*H0;
        const w = (r.x1-r.x0)*W0, h = (r.y1-r.y0)*H0;
        ctx.fillRect(x,y,w,h);
        ctx.strokeRect(x,y,w,h);
      }
      ctx.setLineDash([]);
    }

    // The true star-shaped step region centered at (cx,cy): the disk of
    // radius r with each direction clipped to the first Neumann hit (same
    // ray-box test the walk samples with). WoSt guarantees r <= silhouette
    // distance, so this angular sweep is exactly the star-shaped domain the
    // next point is drawn from — a notched disk, not a plain ball. Returns
    // the boundary polygon in [0,1] domain coords. In WoS (or with no Neumann
    // occluder within r) it collapses to a full circle.
    function computeStar(cx, cy, r) {
      const pts = new Array(STAR_SAMPLES);
      for (let k = 0; k < STAR_SAMPLES; k++) {
        const a = (k / STAR_SAMPLES) * Math.PI * 2;
        const vx = Math.cos(a), vy = Math.sin(a);
        const hit = S.rayHitNeumann(cx, cy, vx, vy, r, scene);
        const t = Math.min(r, hit.t);
        pts[k] = [cx + vx * t, cy + vy * t];
      }
      return pts;
    }

    // Precompute one star polygon per step (once, not per frame). Sub-pixel
    // steps are stored as null and skipped when drawing.
    function buildStars(points, radii) {
      const stars = [];
      if (!points || !radii) return stars;
      const n = Math.min(radii.length, points.length - 1);
      for (let i = 0; i < n; i++) {
        const c = points[i], rad = radii[i];
        stars.push(rad * W0 >= 1 ? computeStar(c[0], c[1], rad) : null);
      }
      return stars;
    }

    function traceStar(star) {
      ctx.beginPath();
      ctx.moveTo(star[0][0]*W0, (1-star[0][1])*H0);
      for (let k = 1; k < star.length; k++) ctx.lineTo(star[k][0]*W0, (1-star[k][1])*H0);
      ctx.closePath();
    }

    function drawWalkSpheres(w, alpha) {
      // Draw each step's star-shaped region up to pointsShown as low-opacity
      // notched disks (the true WoSt construction).
      const pts = w.points;
      if (!pts || pts.length === 0) return;
      const upTo = Math.max(1, Math.min(w.pointsShown | 0, pts.length));
      ctx.save();
      ctx.fillStyle = theme.accent;
      ctx.strokeStyle = theme.accent;
      const stars = w.stars;
      for (let i = 0; stars && i < upTo - 1 && i < stars.length; i++) {
        const star = stars[i];
        if (!star) continue;
        traceStar(star);
        ctx.globalAlpha = alpha * 0.06;
        ctx.fill();
        ctx.globalAlpha = alpha * 0.30;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
      // Walk path polyline
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = theme.walk;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(pts[0][0]*W0, (1-pts[0][1])*H0);
      for (let i = 1; i < upTo; i++) ctx.lineTo(pts[i][0]*W0, (1-pts[i][1])*H0);
      ctx.stroke();
      // Particle dot at the leading edge
      const last = pts[upTo - 1];
      if (!last) { ctx.restore(); return; }
      ctx.fillStyle = theme.walk;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(last[0]*W0, (1-last[1])*H0, 2.5, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }

    function drawHistogram() {
      hctx.clearRect(0,0,HW,HH);
      const bins = C.histBins;
      const counts = new Array(bins).fill(0);
      const maxLog = Math.log10(C.histMaxSteps);
      for (const v of history) {
        const t = Math.min(1, Math.log10(Math.max(1, v)) / maxLog);
        const b = Math.min(bins-1, Math.floor(t * bins));
        counts[b]++;
      }
      const m = Math.max(1, ...counts);
      const bw = HW / bins;
      hctx.fillStyle = theme.interface;
      for (let i = 0; i < bins; i++) {
        const h = (counts[i] / m) * (HH - 24);
        hctx.fillRect(i*bw, HH - 16 - h, bw - 1, h);
      }
      hctx.fillStyle = theme.textMuted;
      hctx.font = `10px ${theme.fontMono}`;
      for (const v of [1, 10, 100, C.histMaxSteps]) {
        const t = Math.log10(v) / maxLog;
        const x = t * HW;
        hctx.fillRect(x, HH - 16, 1, 4);
        hctx.fillText(String(v), x + 2, HH - 4);
      }
      hctx.fillText('walk length (log)', 4, 10);
    }

    function fireBackgroundWalk() {
      // Cheap, recorded-path walks for the histogram + animation queue
      let x, y, tries = 0;
      do {
        x = 0.05 + Math.random()*0.9;
        y = 0.05 + Math.random()*0.9;
        tries++;
        if (tries > 20) return;
      } while (insideObstacle(x, y));
      const r = S.walk(scene, x, y, true);
      history.push(r.steps);
      if (history.length > 400) history.shift();
      const avg = history.reduce((a,b)=>a+b,0) / history.length;
      avgLabel.textContent = `Avg steps: ${avg.toFixed(1)} · samples: ${history.length}`;

      if (activeWalks.length < 2 && r.points && r.points.length > 1) {
        activeWalks.push({ points: r.points, stars: buildStars(r.points, r.radii),
                           pointsShown: 1, t0: performance.now() });
      }
    }

    function insideObstacle(x, y) {
      for (const r of scene.rects) {
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
      }
      return false;
    }

    if (toggle) {
      toggle.addEventListener('change', (e) => {
        if (e.target && e.target.name) {
          solverMode = e.target.value;
          scene.mode = solverMode;
          history = [];
          activeWalks = [];
          ghostWalks = [];
        }
      });
    }

    if (showIfaceCb) {
      showIfaceCb.addEventListener('change', () => { showInterfaces = showIfaceCb.checked; });
    }
    if (showWalksCb) {
      showWalksCb.addEventListener('change', () => { showWalks = showWalksCb.checked; });
    }

    if (speedSlider) {
      const applySpeed = () => {
        speed = Math.pow(10, parseFloat(speedSlider.value));
        if (speedLabel) speedLabel.textContent = `${speed.toFixed(2)}×`;
      };
      speedSlider.addEventListener('input', applySpeed);
      applySpeed();
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        history = [];
        activeWalks = [];
        ghostWalks = [];
        avgLabel.textContent = 'Avg steps: —';
      });
    }

    tileSlider.addEventListener('input', () => {
      const n = parseInt(tileSlider.value);
      tileLabel.textContent = `${n}×${n}`;
      scene = withTiles(n);
      history = [];
      activeWalks = [];
      ghostWalks = [];
    });

    function tick(t) {
      // Ease the interface reveal toward its target before drawing.
      const target = showInterfaces ? 1 : 0;
      const dt = t - (tick._lt || t); tick._lt = t;
      const rate = dt / 600; // full reveal/hide in ~600ms
      if (ifaceReveal < target) ifaceReveal = Math.min(target, ifaceReveal + rate);
      else if (ifaceReveal > target) ifaceReveal = Math.max(target, ifaceReveal - rate);

      drawScene();

      // Ghost trails (fading)
      for (let i = ghostWalks.length - 1; i >= 0; i--) {
        const g = ghostWalks[i];
        const age = t - g.tEnd;
        const alpha = Math.max(0, 0.45 * (1 - age / 1500));
        if (alpha <= 0) { ghostWalks.splice(i, 1); continue; }
        g.pointsShown = g.points.length;
        if (showWalks) drawWalkSpheres(g, alpha);
      }

      // Active walks
      for (let i = activeWalks.length - 1; i >= 0; i--) {
        const w = activeWalks[i];
        const elapsed = t - w.t0;
        // Step every 18ms at 1×; the speed slider scales this.
        const step = Math.min(w.points.length, 1 + Math.floor(elapsed / (18 / speed)));
        w.pointsShown = step;
        if (showWalks) drawWalkSpheres(w, 1);
        if (step >= w.points.length) {
          ghostWalks.push({ points: w.points, stars: w.stars, pointsShown: w.points.length, tEnd: t });
          activeWalks.splice(i, 1);
        }
      }

      drawHistogram();

      // Throttle background walk firing — faster when walks are short
      if (!tick._last || t - tick._last > 60) { fireBackgroundWalk(); tick._last = t; }
      // Also fire some pure-stat walks for histogram convergence
      for (let k = 0; k < 2; k++) {
        let x, y, tries = 0;
        do {
          x = 0.05 + Math.random()*0.9;
          y = 0.05 + Math.random()*0.9;
          tries++;
          if (tries > 10) break;
        } while (insideObstacle(x, y));
        if (tries <= 10) {
          history.push(S.walk(scene, x, y, false).steps);
          if (history.length > 400) history.shift();
        }
      }

      requestAnimationFrame(tick);
    }
    tileLabel.textContent = `${tileSlider.value}×${tileSlider.value}`;
    requestAnimationFrame(tick);
  }

  W.WoDS.interactiveTiles = init;
})(window);
