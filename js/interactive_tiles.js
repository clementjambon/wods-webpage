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

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const canvas = root.querySelector('canvas.diagram');
    const histCanvas = root.querySelector('canvas.hist');
    const tileSlider = root.querySelector('input[data-role="tiles"]');
    const tileLabel = root.querySelector('[data-role="tiles-label"]');
    const avgLabel = root.querySelector('[data-role="avg"]');
    const resetBtn = root.querySelector('button[data-role="reset"]');

    const W0 = 380, H0 = 380;
    const ctx = U.fitCanvas(canvas, W0, H0);
    const HW = 240, HH = 160;
    const hctx = U.fitCanvas(histCanvas, HW, HH);

    const toggle = root.querySelector('[data-role="solver-toggle"]');
    let solverMode = toggle ? (toggle.querySelector('input:checked').value) : 'wost';

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

    function drawScene() {
      ctx.clearRect(0,0,W0,H0);

      // Tile grid
      if (scene.tileInterfaces && scene.tileInterfaces.length > 0) {
        ctx.strokeStyle = theme.interface;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        for (const t of scene.tileInterfaces) {
          ctx.beginPath();
          ctx.moveTo(t.x0*W0, (1-t.y0)*H0);
          ctx.lineTo(t.x1*W0, (1-t.y1)*H0);
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

    function drawWalkSpheres(w, alpha) {
      // Draw all spheres of the walk up to pointsShown as low-opacity disks
      const pts = w.points;
      if (!pts || pts.length === 0) return;
      const upTo = Math.max(1, Math.min(w.pointsShown | 0, pts.length));
      ctx.save();
      ctx.fillStyle = theme.accent;
      ctx.strokeStyle = theme.accent;
      for (let i = 0; i < upTo - 1; i++) {
        const cur = pts[i], nxt = pts[i+1];
        const r = Math.hypot(nxt[0]-cur[0], nxt[1]-cur[1]) * W0;
        if (r < 1) continue;
        ctx.globalAlpha = alpha * 0.06;
        ctx.beginPath();
        ctx.arc(cur[0]*W0, (1-cur[1])*H0, r, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.30;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(cur[0]*W0, (1-cur[1])*H0, r, 0, Math.PI*2);
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
        activeWalks.push({ points: r.points, pointsShown: 1, t0: performance.now() });
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
      drawScene();

      // Ghost trails (fading)
      for (let i = ghostWalks.length - 1; i >= 0; i--) {
        const g = ghostWalks[i];
        const age = t - g.tEnd;
        const alpha = Math.max(0, 0.45 * (1 - age / 1500));
        if (alpha <= 0) { ghostWalks.splice(i, 1); continue; }
        g.pointsShown = g.points.length;
        drawWalkSpheres(g, alpha);
      }

      // Active walks
      for (let i = activeWalks.length - 1; i >= 0; i--) {
        const w = activeWalks[i];
        const elapsed = t - w.t0;
        // Step every 18ms; faster tiles → quick walks anyway
        const step = Math.min(w.points.length, 1 + Math.floor(elapsed / 18));
        w.pointsShown = step;
        drawWalkSpheres(w, 1);
        if (step >= w.points.length) {
          ghostWalks.push({ points: w.points, pointsShown: w.points.length, tEnd: t });
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
