/* Interactive 1 — Watch a walk; histogram of walk lengths.
 *
 * Trajectories play continuously from a random valid origin.
 * Click anywhere (outside Neumann obstacles) to pin the origin;
 * walks then keep restarting from that point. Changing the
 * obstacle count releases the pinned origin.
 *
 * Performance:
 *   - Active-walk visualization is capped at MAX_DRAW_STEPS so
 *     drawWalk stays bounded even when WoSt walks balloon under
 *     heavy Neumann coverage. The walk itself is computed in full
 *     for fidelity, but only the first N points animate.
 *   - Background walks run on a self-chaining setTimeout instead
 *     of inside requestAnimationFrame, so a slow walk never blocks
 *     the next frame and clicks/slider input stay responsive. */
(function (W) {
  const U = W.WoDS.util;
  const S = W.WoDS.solver;
  const Sc = W.WoDS.scenes;
  const C = W.WoDS.config;

  const MAX_DRAW_STEPS = 600; // hard cap on points animated per walk

  // Standard easing curves for the clean-mode jump animation.
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  const easeInOutCubic = (x) => x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2;
  // Fraction of each step spent fading the sphere in before the segment
  // shoots across; the rest plays the eased segment ("hop").
  const FADE_FRAC = 0.5;

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const canvas = root.querySelector('canvas.diagram');
    const histCanvas = root.querySelector('canvas.hist');
    const obstSlider = root.querySelector('input[data-role="obstacles"]');
    const obstLabel = root.querySelector('[data-role="obstacles-label"]');
    const avgLabel = root.querySelector('[data-role="avg"]');
    const resetBtn = root.querySelector('button[data-role="reset"]');
    const speedSlider = root.querySelector('input[data-role="speed"]');
    const speedLabel = root.querySelector('[data-role="speed-label"]');
    const showJumpsCb = root.querySelector('input[data-role="show-jumps"]');
    const cleanModeCb = root.querySelector('input[data-role="clean-mode"]');

    const W0 = 380, H0 = 380;
    const ctx = U.fitCanvas(canvas, W0, H0);
    const HW = 240, HH = 160;
    const hctx = U.fitCanvas(histCanvas, HW, HH);

    const toggle = root.querySelector('[data-role="solver-toggle"]');
    let solverMode = toggle ? (toggle.querySelector('input:checked').value) : 'wost';

    let scene = Sc.layout(parseInt(obstSlider.value));
    scene.mode = solverMode;
    let history = []; // recent walk lengths
    let activeWalk = null;
    let userOrigin = null; // [x,y] in [0,1]^2 if user has pinned an origin
    // Animation speed multiplier (1 = baseline 30ms/step). The slider is
    // log-scaled: its value is log10(speed), so speed = 10^value.
    let speed = speedSlider ? Math.pow(10, parseFloat(speedSlider.value)) : 1;
    // showJumps: dot every visited jump position. cleanMode: animate each
    // jump as a sphere fade-in followed by an eased segment "hop".
    let showJumps = showJumpsCb ? showJumpsCb.checked : false;
    let cleanMode = cleanModeCb ? cleanModeCb.checked : false;

    function isInsideObstacle(x, y) {
      for (const rt of scene.rects) {
        if (x > rt.x0 && x < rt.x1 && y > rt.y0 && y < rt.y1) return true;
      }
      return false;
    }

    function randomOrigin() {
      for (let i = 0; i < 64; i++) {
        const x = 0.05 + Math.random() * 0.9;
        const y = 0.05 + Math.random() * 0.9;
        if (!isInsideObstacle(x, y)) return [x, y];
      }
      return [0.5, 0.5];
    }

    function toScreen(p) { return [p[0]*W0, (1-p[1])*H0]; }

    function drawScene() {
      ctx.clearRect(0,0,W0,H0);

      ctx.lineWidth = 4;
      ctx.strokeStyle = theme.dirichlet;
      ctx.strokeRect(2, 2, W0-4, H0-4);

      ctx.lineWidth = 2;
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

    function drawWalk(w, alpha) {
      if (!w || !w.points) return;
      const pts = w.points;
      const upTo = w.pointsShown;
      const growing = upTo < pts.length;
      // Within-step progress [0,1] of the currently-growing segment.
      const u = (w.subProgress == null) ? 1 : w.subProgress;

      // Clean mode plays each jump as two phases: the sphere fades in
      // (tip paused at the current point), then the segment shoots across
      // to the next point on an ease curve. In normal mode the sphere is
      // fully drawn and the segment isn't (the sphere shows the next hop).
      let segFrac, leadAlpha;
      if (cleanMode && growing) {
        if (u < FADE_FRAC) { segFrac = 0; leadAlpha = easeOutCubic(u / FADE_FRAC); }
        else { segFrac = easeInOutCubic((u - FADE_FRAC) / (1 - FADE_FRAC)); leadAlpha = 1; }
      } else {
        segFrac = cleanMode ? 1 : 0;
        leadAlpha = 1;
      }

      ctx.save();

      // Sphere overlays — the WoS/WoSt construction (kept in both modes).
      ctx.fillStyle = theme.accent;
      ctx.strokeStyle = theme.accent;
      for (let i = 0; i < upTo - 1; i++) {
        const cur = pts[i], nxt = pts[i+1];
        const r = Math.hypot(nxt[0]-cur[0], nxt[1]-cur[1]) * W0;
        if (r < 1) continue;
        const cs = toScreen(cur);
        ctx.globalAlpha = alpha * 0.07;
        ctx.beginPath();
        ctx.arc(cs[0], cs[1], r, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.28;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(cs[0], cs[1], r, 0, Math.PI*2);
        ctx.stroke();
      }
      if (growing) {
        // Leading sphere — fades in during the clean-mode hop.
        const cur = pts[upTo - 1], nxt = pts[upTo];
        const r = Math.hypot(nxt[0]-cur[0], nxt[1]-cur[1]) * W0;
        if (r >= 1) {
          const cs = toScreen(cur);
          ctx.globalAlpha = alpha * 0.12 * leadAlpha;
          ctx.fillStyle = theme.accent;
          ctx.beginPath();
          ctx.arc(cs[0], cs[1], r, 0, Math.PI*2);
          ctx.fill();
          ctx.globalAlpha = alpha * 0.55 * leadAlpha;
          ctx.strokeStyle = theme.accent;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cs[0], cs[1], r, 0, Math.PI*2);
          ctx.stroke();
        }
      }

      // Trajectory polyline through the points reached so far, plus the
      // eased leading segment (clean mode).
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = theme.walk;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const p0 = toScreen(pts[0]);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < upTo; i++) {
        const p = toScreen(pts[i]);
        ctx.lineTo(p[0], p[1]);
      }
      let tip;
      if (growing && segFrac > 0) {
        const a = pts[upTo - 1], b = pts[upTo];
        tip = toScreen([a[0] + (b[0]-a[0])*segFrac, a[1] + (b[1]-a[1])*segFrac]);
        ctx.lineTo(tip[0], tip[1]);
      } else {
        tip = toScreen(pts[upTo - 1]);
      }
      ctx.stroke();

      // Particle dot at the leading tip.
      ctx.fillStyle = theme.walk;
      ctx.beginPath();
      ctx.arc(tip[0], tip[1], 3, 0, Math.PI*2);
      ctx.fill();

      // Every visited jump position as a small dot.
      if (showJumps) {
        ctx.fillStyle = theme.walk;
        for (let i = 0; i < upTo; i++) {
          const p = toScreen(pts[i]);
          ctx.beginPath();
          ctx.arc(p[0], p[1], 2.2, 0, Math.PI*2);
          ctx.fill();
        }
      }
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
      hctx.fillStyle = theme.accent;
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
      const x = 0.1 + Math.random() * 0.8;
      const y = 0.1 + Math.random() * 0.8;
      const r = S.walk(scene, x, y, false);
      history.push(r.steps);
      if (history.length > 400) history.shift();
      const avg = history.reduce((a,b)=>a+b,0) / history.length;
      avgLabel.textContent = `Avg steps: ${avg.toFixed(1)} · samples: ${history.length}`;
    }

    function startActiveWalk(x, y) {
      const r = S.walk(scene, x, y, true);
      // Cap visualized path length so per-frame drawWalk cost stays bounded.
      if (r.points && r.points.length > MAX_DRAW_STEPS) {
        r.points = r.points.slice(0, MAX_DRAW_STEPS);
      }
      activeWalk = { ...r, pointsShown: 1, t0: performance.now() };
    }

    function startNextWalk() {
      let origin;
      if (userOrigin && !isInsideObstacle(userOrigin[0], userOrigin[1])) {
        origin = userOrigin;
      } else {
        origin = randomOrigin();
      }
      startActiveWalk(Math.max(0.005, Math.min(0.995, origin[0])),
                      Math.max(0.005, Math.min(0.995, origin[1])));
    }

    function rebuildScene() {
      const n = parseInt(obstSlider.value);
      obstLabel.textContent = `${n}`;
      scene = Sc.layout(n);
      scene.mode = solverMode;
      history = [];
      activeWalk = null;
      userOrigin = null;
    }

    if (toggle) {
      toggle.addEventListener('change', (e) => {
        if (e.target && e.target.name) {
          solverMode = e.target.value;
          scene.mode = solverMode;
          history = [];
          activeWalk = null;
        }
      });
    }

    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      if (isInsideObstacle(x, y)) return;
      userOrigin = [Math.max(0.005, Math.min(0.995, x)),
                    Math.max(0.005, Math.min(0.995, y))];
      activeWalk = null; // restart immediately from new origin
    });
    obstSlider.addEventListener('input', rebuildScene);
    resetBtn.addEventListener('click', () => { history = []; activeWalk = null; });
    if (speedSlider) {
      const applySpeed = () => {
        speed = Math.pow(10, parseFloat(speedSlider.value));
        if (speedLabel) speedLabel.textContent = `${speed.toFixed(2)}×`;
      };
      speedSlider.addEventListener('input', applySpeed);
      applySpeed();
    }
    if (showJumpsCb) {
      showJumpsCb.addEventListener('change', () => { showJumps = showJumpsCb.checked; });
    }
    if (cleanModeCb) {
      cleanModeCb.addEventListener('change', () => { cleanMode = cleanModeCb.checked; });
    }

    // Background walks on a self-chaining timeout: if a single walk
    // is slow, the next one fires later instead of piling up behind
    // requestAnimationFrame and starving input handlers.
    function scheduleBackgroundWalk() {
      setTimeout(() => {
        try { fireBackgroundWalk(); } finally { scheduleBackgroundWalk(); }
      }, 100);
    }

    function tick(t) {
      drawScene();
      if (!activeWalk) {
        startNextWalk();
        // Re-anchor t0 to the rAF clock. S.walk runs synchronously inside
        // startNextWalk and can take many ms, but t was captured before
        // this frame began — without this, elapsed is negative on the
        // first tick of a walk and stepsToShow underflows to <=0, which
        // makes drawWalk dereference pts[-1] and throws (silently kills
        // the loop in Firefox/Safari).
        if (activeWalk) activeWalk.t0 = t;
      }
      if (activeWalk) {
        const msPerStep = 30 / speed;
        const elapsed = Math.max(0, t - activeWalk.t0);
        const prog = elapsed / msPerStep; // fractional step count
        const stepsToShow = Math.min(activeWalk.points.length,
                                     Math.max(1, 1 + Math.floor(prog)));
        activeWalk.pointsShown = stepsToShow;
        activeWalk.subProgress = (stepsToShow < activeWalk.points.length)
          ? prog - Math.floor(prog) : 1;
        drawWalk(activeWalk, 1);
        if (stepsToShow >= activeWalk.points.length) {
          if (elapsed > activeWalk.points.length * msPerStep + 400) activeWalk = null;
        }
      }
      if (userOrigin) {
        const cs = toScreen(userOrigin);
        ctx.save();
        ctx.fillStyle = theme.walk;
        ctx.strokeStyle = theme.bg || '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cs[0], cs[1], 4.5, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      drawHistogram();
      requestAnimationFrame(tick);
    }
    rebuildScene();
    scheduleBackgroundWalk();
    requestAnimationFrame(tick);
  }

  W.WoDS.interactiveWalks = init;
})(window);
