/* Toy Brownian motion: a particle diffuses from an interior point
 * until it hits the boundary, where it is absorbed. Boundary is
 * colored by g (a smooth function around the square) using a
 * continuous gradient. When the walk lands, a katex-rendered label
 * "Z_\tau" is positioned next to the hit point.
 *
 * Non-interactive: pure illustration. */
(function (W) {
  const U = W.WoDS.util;

  function init(root) {
    const theme = W.WoDS.theme();
    const canvas = root.querySelector('canvas.diagram');
    const label = root.querySelector('[data-role="hit-label"]');
    const xLabel = root.querySelector('[data-role="x-label"]');
    const eqLabel = root.querySelector('[data-role="eq-label"]');

    // Generous padding so labels don't crop at the edges. Extra bottom
    // room reserved for the u(x) = E[u(Z_tau)] equation.
    const W0 = 380, H0 = 420;
    const ctx = U.fitCanvas(canvas, W0, H0);

    const PAD = 36, PAD_BOTTOM = 64;
    const X0 = PAD, Y0 = PAD, X1 = W0 - PAD, Y1 = H0 - PAD_BOTTOM;
    const SW = X1 - X0, SH = Y1 - Y0;

    // g around the perimeter, parameterized by arc length s in [0,1).
    function gAtS(s) {
      return Math.cos(2 * Math.PI * s);
    }
    function gAtUV(u, v) {
      const eps = 1e-6;
      let s;
      if (v < eps) s = u * 0.25;
      else if (u > 1 - eps) s = 0.25 + v * 0.25;
      else if (v > 1 - eps) s = 0.5 + (1 - u) * 0.25;
      else s = 0.75 + (1 - v) * 0.25;
      return gAtS(s);
    }
    function colorFor(val) {
      const t = 0.5 + 0.5 * val;
      return U.colormap(t, theme);
    }

    // Build a CanvasGradient for one side using sampled stops.
    function sideGradient(x0, y0, x1, y1, sStart, sEnd) {
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      const N = 32;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const s = sStart + (sEnd - sStart) * t;
        grad.addColorStop(t, colorFor(gAtS(s)));
      }
      return grad;
    }

    function drawBoundary() {
      ctx.lineWidth = 4;
      // Square (not butt) caps so each side extends by half the line
      // width and the four corners meet flush. With butt caps the
      // separately-stroked sides leave a notch at each corner.
      ctx.lineCap = 'square';
      // bottom: s in [0, 0.25], left->right
      ctx.strokeStyle = sideGradient(X0, Y1, X1, Y1, 0.00, 0.25);
      ctx.beginPath(); ctx.moveTo(X0, Y1); ctx.lineTo(X1, Y1); ctx.stroke();
      // right: s in [0.25, 0.5], bottom->top
      ctx.strokeStyle = sideGradient(X1, Y1, X1, Y0, 0.25, 0.50);
      ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X1, Y0); ctx.stroke();
      // top: s in [0.5, 0.75], right->left
      ctx.strokeStyle = sideGradient(X1, Y0, X0, Y0, 0.50, 0.75);
      ctx.beginPath(); ctx.moveTo(X1, Y0); ctx.lineTo(X0, Y0); ctx.stroke();
      // left: s in [0.75, 1.0], top->bottom
      ctx.strokeStyle = sideGradient(X0, Y0, X0, Y1, 0.75, 1.00);
      ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X0, Y1); ctx.stroke();
    }

    function uvToScreen(u, v) {
      return [X0 + u * SW, Y1 - v * SH];
    }

    const STEP = 0.012;
    const START = [0.5, 0.5];
    let trail = [];
    let pos = START.slice();
    let phase = 'idle'; // idle | walking | landed
    let landedAt = null;
    let landedT = 0;

    const dropBtn = root.querySelector('[data-role="drop"]');
    const clearBtn = root.querySelector('[data-role="clear"]');

    function renderTex(el, src, fallback) {
      if (window.katex) {
        try { window.katex.render(src, el, { throwOnError: false }); return; }
        catch (e) { /* fall through */ }
      }
      el.textContent = fallback;
    }

    renderTex(label, 'Z_\\tau', 'Z_τ');
    renderTex(xLabel, 'x', 'x');
    renderTex(eqLabel, 'u(x) = \\mathbb{E}[g(Z_\\tau)]', 'u(x) = E[g(Z_τ)]');

    // Position the static x label beside the start point.
    {
      const [sx, sy] = uvToScreen(START[0], START[1]);
      xLabel.style.left = `${sx + 12}px`;
      xLabel.style.top = `${sy - 10}px`;
    }

    // Park the particle at the start point without walking. The walk
    // only begins when the user presses "Drop particle".
    function goIdle() {
      pos = START.slice();
      trail = [pos.slice()];
      phase = 'idle';
      landedAt = null;
      label.style.opacity = '0';
    }

    function startWalk() {
      pos = START.slice();
      trail = [pos.slice()];
      phase = 'walking';
      landedAt = null;
      label.style.opacity = '0';
    }

    if (dropBtn) dropBtn.addEventListener('click', startWalk);
    if (clearBtn) clearBtn.addEventListener('click', goIdle);

    function gauss() {
      const u1 = Math.max(1e-9, Math.random());
      const u2 = Math.random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    function step() {
      if (phase !== 'walking') return;
      let nx = pos[0] + gauss() * STEP;
      let ny = pos[1] + gauss() * STEP;
      if (nx <= 0 || nx >= 1 || ny <= 0 || ny >= 1) {
        nx = Math.max(0, Math.min(1, nx));
        ny = Math.max(0, Math.min(1, ny));
        pos = [nx, ny];
        trail.push(pos.slice());
        landedAt = pos.slice();
        landedT = performance.now();
        phase = 'landed';
        positionLabel();
        return;
      }
      pos = [nx, ny];
      trail.push(pos.slice());
      if (trail.length > 4000) trail.shift();
    }

    function positionLabel() {
      if (!landedAt) return;
      const [sx, sy] = uvToScreen(landedAt[0], landedAt[1]);
      // Push the label outward from the boundary so it sits in the
      // padded margin, fully visible.
      const OFF = 18;
      let lx = sx, ly = sy;
      if (landedAt[0] < 0.02) lx = sx - OFF;
      else if (landedAt[0] > 0.98) lx = sx + OFF;
      if (landedAt[1] < 0.02) ly = sy + OFF;       // bottom wall: label below
      else if (landedAt[1] > 0.98) ly = sy - OFF;  // top wall: label above
      // For corners or middle-of-side, the offset above already moves
      // the label to the correct margin.
      // Convert canvas coords -> CSS px (canvas is sized via fitCanvas
      // to W0xH0 CSS pixels, so 1:1).
      label.style.left = `${lx}px`;
      label.style.top = `${ly}px`;
      label.style.opacity = '1';
    }

    function drawTrail() {
      if (trail.length < 2) return;
      ctx.save();
      ctx.strokeStyle = theme.walk;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      const p0 = uvToScreen(trail[0][0], trail[0][1]);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < trail.length; i++) {
        const p = uvToScreen(trail[i][0], trail[i][1]);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawDots() {
      // Start point x.
      const s = uvToScreen(START[0], START[1]);
      ctx.save();
      ctx.fillStyle = theme.text;
      ctx.beginPath();
      ctx.arc(s[0], s[1], 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Particle: keep it neutral throughout.
      const cur = trail[trail.length - 1];
      if (cur) {
        const c = uvToScreen(cur[0], cur[1]);
        ctx.save();
        ctx.fillStyle = theme.walk;
        ctx.strokeStyle = theme.surface;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c[0], c[1], 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Canvas-drawn equivalents of the HTML overlay labels, used only
    // while recording (W.WoDS.captureMode) since the HTML overlays live
    // outside the canvas and aren't captured. Uses KaTeX's math font
    // (loaded via the KaTeX stylesheet) so it matches the live labels,
    // with a white halo standing in for their drop-shadow.
    function drawMathLabel(cx, cy, main, sub, alpha) {
      const mainFont = 'italic 20px KaTeX_Math, Georgia, "Times New Roman", serif';
      const subFont = 'italic 13px KaTeX_Math, Georgia, "Times New Roman", serif';
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = mainFont;
      const wMain = ctx.measureText(main).width;
      let wSub = 0;
      if (sub) { ctx.font = subFont; wSub = ctx.measureText(sub).width; }
      const x0 = cx - (wMain + wSub) / 2;
      ctx.fillStyle = theme.text;
      ctx.shadowColor = theme.surface;
      ctx.shadowBlur = 3;
      // Stroke the dark glyphs a few times so the white shadow builds
      // up into a legible halo (mirrors the triple HTML drop-shadow).
      for (let k = 0; k < 3; k++) {
        ctx.font = mainFont;
        ctx.fillText(main, x0, cy);
        if (sub) { ctx.font = subFont; ctx.fillText(sub, x0 + wMain, cy + 6); }
      }
      ctx.restore();
    }

    function drawCaptureLabels(t) {
      // x beside the start point (mirrors x-label at sx+12, sy-10).
      const s = uvToScreen(START[0], START[1]);
      drawMathLabel(s[0] + 12, s[1] - 10, 'x', null, 1);
      // Z_τ at the landing point (mirrors positionLabel + its fade-in).
      if (phase === 'landed' && landedAt) {
        const [sx, sy] = uvToScreen(landedAt[0], landedAt[1]);
        const OFF = 18;
        let lx = sx, ly = sy;
        if (landedAt[0] < 0.02) lx = sx - OFF;
        else if (landedAt[0] > 0.98) lx = sx + OFF;
        if (landedAt[1] < 0.02) ly = sy + OFF;
        else if (landedAt[1] > 0.98) ly = sy - OFF;
        const a = Math.min(1, (t - landedT) / 120);
        drawMathLabel(lx, ly, 'Z', 'τ', a);
      }
    }

    // Show/hide the HTML overlay labels to match capture mode so they
    // don't double up with the canvas-drawn versions on screen.
    let _capState = null;
    function syncLabelVisibility() {
      const cap = !!W.WoDS.captureMode;
      if (cap === _capState) return;
      _capState = cap;
      const vis = cap ? 'hidden' : '';
      xLabel.style.visibility = vis;
      label.style.visibility = vis;
    }

    let lastStep = 0;
    function tick(t) {
      ctx.clearRect(0, 0, W0, H0);
      drawBoundary();
      drawTrail();

      if (phase === 'idle') {
        // In capture mode there is no one to press the button, so keep
        // the recording self-driving by dropping a particle on its own.
        if (W.WoDS.captureMode) { startWalk(); lastStep = t; }
      } else if (phase === 'walking') {
        const dt = t - lastStep;
        const n = Math.min(8, Math.max(1, Math.floor(dt / 4)));
        for (let i = 0; i < n; i++) step();
        lastStep = t;
      } else if (phase === 'landed') {
        // Auto-loop only while recording; interactively the walk stays
        // put until the user drops another particle.
        if (W.WoDS.captureMode && t - landedT > 1100) {
          startWalk();
          lastStep = t;
        }
      }

      drawDots();
      syncLabelVisibility();
      if (W.WoDS.captureMode) drawCaptureLabels(t);
      requestAnimationFrame(tick);
    }

    goIdle();
    requestAnimationFrame(tick);
  }

  W.WoDS.interactiveBrownian = init;
})(window);
