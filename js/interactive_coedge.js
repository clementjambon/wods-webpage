/* Walk on Co-edge Subdomains — naive animated illustration.
 *
 * Same scene as #subkernel / #binop (Sc.layout(12) on an n×n tile grid).
 * A walker hops from interface to interface. At each hop it sits on a
 * tile interface; the two tiles sharing that edge form the "co-edge
 * subdomain" (a 2×1 or 1×2 rectangle, highlighted in blue like the
 * slides). Rather than running a real walk inside it, we just pick a
 * uniformly random exit on the subdomain's boundary — rejection-sampling
 * any point that falls into the Neumann geometry — and jump straight
 * there. The chosen point lands on a new interface, re-centering the next
 * co-edge subdomain, until the walk exits on the global boundary at Z_τ.
 *
 * This is deliberately fake and naive (uniform over exits rather than the
 * true harmonic measure) — it's an educational cartoon of the method.
 *
 * Only ONE trajectory is shown at a time. All labels are drawn on the
 * canvas so the capture tool records them. */
(function (W) {
  const U = W.WoDS.util;
  const Sc = W.WoDS.scenes;

  const MAX_HOPS = 200;   // safety cap (the walk reaches the boundary a.s.)
  const SEG_MS = 420;     // base time to draw one hop segment (at 1× speed)
  const PAUSE_MS = 130;   // dwell between hops (at 1× speed)
  const HOLD_MS = 1700;   // dwell on the final state before restarting
  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]; // integer slider index -> multiplier

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const canvas = root.querySelector('canvas.diagram');
    // The sliders/buttons are studio-only; on the public page the figure just
    // auto-loops (n=6, 1× speed) with the canvas still click-to-launch. All
    // control refs are null-guarded below, so gating them to null is enough.
    const STUDIO = W.WoDS.inStudio;
    const tileSlider = STUDIO ? root.querySelector('input[data-role="tiles"]') : null;
    const tileLabel = STUDIO ? root.querySelector('[data-role="tiles-label"]') : null;
    const speedSlider = STUDIO ? root.querySelector('input[data-role="speed"]') : null;
    const speedLabel = STUDIO ? root.querySelector('[data-role="speed-label"]') : null;
    const newBtn = STUDIO ? root.querySelector('[data-role="new"]') : null;
    const playBtn = STUDIO ? root.querySelector('[data-role="play"]') : null;
    const releaseBtn = STUDIO ? root.querySelector('[data-role="release"]') : null;

    const W0 = 400, H0 = 400, PAD = 44, SQ = W0 - 2 * PAD;
    const ctx = U.fitCanvas(canvas, W0, H0);

    const baseScene = Sc.layout(12); // Dirichlet square + 12 Neumann rects
    let n = tileSlider ? parseInt(tileSlider.value) : 6;
    function speedFor(v) { return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, v | 0))]; }
    let speed = speedSlider ? speedFor(parseInt(speedSlider.value)) : 1;
    let paused = false;
    let pin = null; // clicked start location {x,y,axis,idx}, or null for random

    function toScreen(x, y) { return [PAD + x * SQ, PAD + (1 - y) * SQ]; }

    function inObstacle(x, y, slack) {
      slack = slack || 0;
      for (const r of baseScene.rects) {
        if (x > r.x0 - slack && x < r.x1 + slack &&
            y > r.y0 - slack && y < r.y1 + slack) return true;
      }
      return false;
    }

    // The co-edge subdomain around an interface point: the two tiles
    // sharing the interface edge. axis 'v' → vertical interface at
    // x=idx/n → left+right tiles (2 wide, 1 tall). axis 'h' → horizontal
    // interface at y=idx/n → bottom+top tiles (1 wide, 2 tall).
    function coedgeAround(px, py, axis, idx) {
      const L = 1 / n;
      if (axis === 'v') {
        const row = Math.min(n - 1, Math.max(0, Math.floor(py * n)));
        return { x0: (idx - 1) * L, x1: (idx + 1) * L, y0: row * L, y1: (row + 1) * L };
      }
      const col = Math.min(n - 1, Math.max(0, Math.floor(px * n)));
      return { x0: col * L, x1: (col + 1) * L, y0: (idx - 1) * L, y1: (idx + 1) * L };
    }

    // Pick a uniformly random exit on the co-edge boundary, rejection-
    // sampling points that land inside the Neumann geometry. Returns the
    // exit point, the interface it sits on, and whether it's the global
    // boundary — or null if every side is blocked.
    function sampleExit(rect) {
      for (let t = 0; t < 80; t++) {
        const side = Math.floor(Math.random() * 4);
        let x, y, axis, idx;
        if (side === 0) { x = rect.x0; y = rect.y0 + Math.random() * (rect.y1 - rect.y0); }
        else if (side === 1) { x = rect.x1; y = rect.y0 + Math.random() * (rect.y1 - rect.y0); }
        else if (side === 2) { y = rect.y0; x = rect.x0 + Math.random() * (rect.x1 - rect.x0); }
        else { y = rect.y1; x = rect.x0 + Math.random() * (rect.x1 - rect.x0); }
        if (inObstacle(x, y, 0.005)) continue; // reject exits inside the geometry
        if (side < 2) { axis = 'v'; idx = Math.round(x * n); }
        else { axis = 'h'; idx = Math.round(y * n); }
        return { x, y, axis, idx, global: idx <= 0 || idx >= n };
      }
      return null;
    }

    // Canvas coords -> unit-square coords.
    function evToScene(e) {
      const r = canvas.getBoundingClientRect();
      const cx = (e.clientX - r.left) / r.width * W0;
      const cy = (e.clientY - r.top) / r.height * H0;
      return [(cx - PAD) / SQ, 1 - (cy - PAD) / SQ];
    }

    // Snap a click to the nearest interior interface: the closer of the
    // nearest vertical / horizontal grid line, with the point placed at
    // the click's position along it.
    function pickInterface(cx, cy) {
      const iv = Math.round(cx * n), ih = Math.round(cy * n);
      if (Math.abs(cx - iv / n) <= Math.abs(cy - ih / n)) {
        const idx = Math.min(n - 1, Math.max(1, iv));
        return { x: idx / n, y: Math.min(0.98, Math.max(0.02, cy)), axis: 'v', idx };
      }
      const idx = Math.min(n - 1, Math.max(1, ih));
      return { x: Math.min(0.98, Math.max(0.02, cx)), y: idx / n, axis: 'h', idx };
    }

    function sampleStart() {
      for (let t = 0; t < 400; t++) {
        const axis = Math.random() < 0.5 ? 'v' : 'h';
        const idx = 1 + Math.floor(Math.random() * (n - 1)); // interior line 1..n-1
        const along = 0.04 + Math.random() * 0.92;
        const x = axis === 'v' ? idx / n : along;
        const y = axis === 'v' ? along : idx / n;
        if (inObstacle(x, y, 0.01)) continue;
        return { x, y, axis, idx };
      }
      const idx = Math.max(1, Math.floor(n / 2));
      return { x: idx / n, y: 0.5, axis: 'v', idx };
    }

    // One run: a polyline of hop points plus the co-edge rectangle used
    // for each hop.
    function buildRun() {
      const s = pin || sampleStart();
      let axis = s.axis, idx = s.idx;
      const pts = [{ x: s.x, y: s.y }];
      const rects = [];
      let reached = false;
      for (let g = 0; g < MAX_HOPS; g++) {
        const p = pts[pts.length - 1];
        const rect = coedgeAround(p.x, p.y, axis, idx);
        const next = sampleExit(rect);
        if (!next) break; // fully blocked — stop here
        rects.push(rect);
        pts.push({ x: next.x, y: next.y });
        if (next.global) { reached = true; break; }
        axis = next.axis; idx = next.idx;
      }
      return { pts, rects, reached };
    }

    // ---- Animation state --------------------------------------------
    let run = buildRun();
    let seg = 0;          // current hop segment (pts[seg] -> pts[seg+1])
    let prog = 0;         // progress along the current segment [0,1]
    let phase = 'walking'; // walking | pausing | done
    let pauseUntil = 0, doneUntil = 0, lastT = 0;

    function restart() {
      run = buildRun();
      seg = 0; prog = 0; phase = 'walking';
    }

    function advance(t) {
      if (paused) return;
      const dt = Math.min(64, t - lastT);
      if (run.rects.length === 0) { phase = 'done'; doneUntil = t + HOLD_MS; }
      if (phase === 'walking') {
        prog += dt / (SEG_MS / speed);
        if (prog >= 1) {
          prog = 1;
          if (seg >= run.rects.length - 1) { phase = 'done'; doneUntil = t + HOLD_MS; }
          else { phase = 'pausing'; pauseUntil = t + PAUSE_MS / speed; }
        }
      } else if (phase === 'pausing') {
        if (t >= pauseUntil) { seg++; prog = 0; phase = 'walking'; }
      } else if (phase === 'done') {
        if (t >= doneUntil) restart();
      }
    }

    // ---- Rendering ---------------------------------------------------
    function drawScene() {
      ctx.clearRect(0, 0, W0, H0);

      // Current co-edge subdomain highlight (fill under the grid).
      const rect = run.rects[Math.min(seg, run.rects.length - 1)];
      if (rect) {
        const tl = toScreen(rect.x0, rect.y1);
        ctx.fillStyle = 'rgba(42,95,184,0.14)';
        ctx.fillRect(tl[0], tl[1], (rect.x1 - rect.x0) * SQ, (rect.y1 - rect.y0) * SQ);
      }

      // Orange tile grid.
      ctx.strokeStyle = theme.interface;
      ctx.lineWidth = 1.5;
      for (let i = 1; i < n; i++) {
        const u = i / n;
        let a = toScreen(u, 0), b = toScreen(u, 1);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        a = toScreen(0, u); b = toScreen(1, u);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }

      // Outer Dirichlet square.
      const o = toScreen(0, 1);
      ctx.lineWidth = 3; ctx.strokeStyle = theme.dirichlet;
      ctx.strokeRect(o[0], o[1], SQ, SQ);

      // Neumann obstacles.
      ctx.fillStyle = theme.neumannFill;
      ctx.strokeStyle = theme.neumann;
      ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      for (const r of baseScene.rects) {
        const tl = toScreen(r.x0, r.y1);
        ctx.fillRect(tl[0], tl[1], (r.x1 - r.x0) * SQ, (r.y1 - r.y0) * SQ);
        ctx.strokeRect(tl[0], tl[1], (r.x1 - r.x0) * SQ, (r.y1 - r.y0) * SQ);
      }
      ctx.setLineDash([]);

      // Co-edge outline (on top of the obstacles).
      if (rect) {
        const tl = toScreen(rect.x0, rect.y1);
        ctx.lineWidth = 2.5; ctx.strokeStyle = theme.accent;
        ctx.strokeRect(tl[0], tl[1], (rect.x1 - rect.x0) * SQ, (rect.y1 - rect.y0) * SQ);
      }

      drawTrajectory();
      drawLabels();
    }

    function drawTrajectory() {
      // Revealed polyline: completed hops plus the growing current one.
      ctx.save();
      ctx.strokeStyle = theme.walk;
      ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      const p0 = toScreen(run.pts[0].x, run.pts[0].y);
      ctx.moveTo(p0[0], p0[1]);
      for (let k = 1; k <= seg; k++) {
        const p = toScreen(run.pts[k].x, run.pts[k].y);
        ctx.lineTo(p[0], p[1]);
      }
      if (seg + 1 < run.pts.length) {
        const a = run.pts[seg], b = run.pts[seg + 1];
        const p = toScreen(a.x + (b.x - a.x) * prog, a.y + (b.y - a.y) * prog);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
      ctx.restore();

      // Dots at each interface crossing reached so far.
      for (let k = 1; k <= seg; k++) dot(toScreen(run.pts[k].x, run.pts[k].y), 3.2);
    }

    function dot(s, rad) {
      ctx.save();
      ctx.fillStyle = theme.walk;
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(s[0], s[1], rad, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    function drawLabels() {
      const start = run.pts[0];
      const s = toScreen(start.x, start.y);
      dot(s, 3.2);
      mathLabel(s[0] + 12, s[1] - 11, 'x', null);

      // Z_τ when the walk reaches the global boundary.
      if (phase === 'done' && run.reached) {
        const e = run.pts[run.pts.length - 1];
        const p = toScreen(e.x, e.y);
        dot(p, 3.6);
        const OFF = 18;
        let lx = p[0], ly = p[1];
        if (e.x < 0.02) lx = p[0] - OFF; else if (e.x > 0.98) lx = p[0] + OFF;
        if (e.y < 0.02) ly = p[1] + OFF; else if (e.y > 0.98) ly = p[1] - OFF;
        mathLabel(lx, ly, 'Z', 'τ');
      }
    }

    // In-canvas KaTeX-style math label with a white halo (drawn on the
    // canvas so capture records it).
    function mathLabel(cx, cy, main, sub) {
      const mainFont = 'italic 20px KaTeX_Math, Georgia, "Times New Roman", serif';
      const subFont = 'italic 13px KaTeX_Math, Georgia, "Times New Roman", serif';
      ctx.save();
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.font = mainFont;
      const wMain = ctx.measureText(main).width;
      let wSub = 0;
      if (sub) { ctx.font = subFont; wSub = ctx.measureText(sub).width; }
      const x0 = cx - (wMain + wSub) / 2;
      ctx.fillStyle = theme.text;
      ctx.shadowColor = theme.surface; ctx.shadowBlur = 3;
      for (let k = 0; k < 3; k++) {
        ctx.font = mainFont; ctx.fillText(main, x0, cy);
        if (sub) { ctx.font = subFont; ctx.fillText(sub, x0 + wMain, cy + 6); }
      }
      ctx.restore();
    }

    function frame(t) {
      if (!lastT) lastT = t;
      advance(t);
      lastT = t;
      drawScene();
      requestAnimationFrame(frame);
    }

    // ---- Controls ----------------------------------------------------
    function setPin(p) {
      pin = p;
      if (releaseBtn) releaseBtn.style.display = p ? '' : 'none';
      restart();
    }

    // Click an interface to launch walks from that location.
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = evToScene(e);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      const p = pickInterface(x, y);
      if (inObstacle(p.x, p.y, 0.005)) return; // don't pin inside the geometry
      setPin(p);
    });

    if (tileSlider) {
      tileSlider.addEventListener('input', () => {
        n = parseInt(tileSlider.value);
        if (tileLabel) tileLabel.textContent = `${n}×${n}`;
        setPin(null); // grid changed — drop any pinned interface
      });
    }
    if (speedSlider) {
      const upd = () => {
        speed = speedFor(parseInt(speedSlider.value));
        if (speedLabel) speedLabel.textContent = `${speed}×`;
      };
      speedSlider.addEventListener('input', upd);
      upd();
    }
    if (newBtn) newBtn.addEventListener('click', restart);
    if (releaseBtn) releaseBtn.addEventListener('click', () => setPin(null));
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        paused = !paused;
        playBtn.textContent = paused ? '▶ Play' : '⏸ Pause';
      });
    }

    if (tileLabel) tileLabel.textContent = `${n}×${n}`;
    requestAnimationFrame(frame);
  }

  W.WoDS.interactiveCoedge = init;
})(window);
