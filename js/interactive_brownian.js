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

    // TEMP export hack (?ibrownexport=1): drop the bottom padding so the
    // domain sits flush against the frame bottom, and only show walks that
    // exit on the top/left/right (see step()). For slide trajectories.
    const EXPORT = new URLSearchParams(W.location.search).has('ibrownexport');

    // Generous padding so labels don't crop at the edges. Extra bottom
    // room reserved for the u(x) = E[u(Z_tau)] equation.
    const W0 = 380;
    const PAD = 36;
    const SIDE = W0 - 2 * PAD; // domain side length
    // Normally 64px hold the equation overlay; in export mode ~0 (2px so
    // the 4px boundary stroke isn't clipped) with a square domain flush
    // to the bottom.
    const PAD_BOTTOM = EXPORT ? 2 : 64;
    const H0 = EXPORT ? (PAD + SIDE + PAD_BOTTOM) : 420;
    const ctx = U.fitCanvas(canvas, W0, H0);

    const X0 = PAD, Y0 = PAD, X1 = W0 - PAD, Y1 = H0 - PAD_BOTTOM;
    const SW = X1 - X0, SH = Y1 - Y0;

    // The extra bottom padding holds the u(x) = E[g(Z_tau)] equation,
    // which is an HTML overlay and so is absent from the recording. When
    // capturing, nudge everything down by half that surplus so the square
    // sits vertically centered in the exported frame. (No shift in export
    // mode — the domain is already flush.)
    const CAP_SHIFT_Y = EXPORT ? 0 : (PAD_BOTTOM - PAD) / 2;

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
    // In reject-sampling mode the accepted walk is computed up front and
    // then played back: fullTrail holds it, revealIdx tracks the playback.
    // null in live mode (all sides allowed / export capture).
    let fullTrail = null;
    let revealIdx = 0;

    // On the public page the walk auto-plays (drop → land → pause → repeat),
    // as before. The studio adds "Drop particle" / "Clear" buttons so a walk
    // can be triggered on cue for recording; there it starts idle instead.
    const STUDIO = W.WoDS.inStudio;
    const dropBtn = STUDIO ? root.querySelector('[data-role="drop"]') : null;
    const clearBtn = STUDIO ? root.querySelector('[data-role="clear"]') : null;

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
    if (EXPORT && eqLabel) eqLabel.style.display = 'none'; // no room in export mode

    // Overlay labels are positioned in canvas coordinate space (W0xH0),
    // but on narrow viewports CSS scales the canvas down (max-width:100%),
    // so a raw-pixel offset drifts off the shrunken canvas. Map each
    // canvas-space point through the live display scale (and the canvas's
    // offset within its positioned parent) before setting left/top.
    function placeLabel(el, cx, cy) {
      const scale = (canvas.clientWidth || W0) / W0;
      el.style.left = `${canvas.offsetLeft + cx * scale}px`;
      el.style.top = `${canvas.offsetTop + cy * scale}px`;
    }

    // Static x label sits beside the start point; the hit label is placed
    // once the walk lands. Both are re-laid-out every tick so they track
    // the canvas across viewport resizes.
    const startScreen = uvToScreen(START[0], START[1]);
    const xLabelPos = [startScreen[0] + 12, startScreen[1] - 10];
    let hitLabelPos = null;
    function layoutLabels() {
      placeLabel(xLabel, xLabelPos[0], xLabelPos[1]);
      if (hitLabelPos) placeLabel(label, hitLabelPos[0], hitLabelPos[1]);
    }

    // Park the particle at the start point without walking. The walk
    // only begins when the user presses "Drop particle".
    function goIdle() {
      pos = START.slice();
      trail = [pos.slice()];
      phase = 'idle';
      landedAt = null;
      hitLabelPos = null;
      fullTrail = null;
      label.style.opacity = '0';
    }

    function startWalk() {
      pos = START.slice();
      trail = [pos.slice()];
      phase = 'walking';
      landedAt = null;
      hitLabelPos = null;
      label.style.opacity = '0';
      // With sides rejected, precompute an accepted walk instantly so the
      // hidden search never leaves the canvas blank; playback then reveals
      // it at the usual pace. Live mode walks stochastically as before.
      fullTrail = rejectActive() ? precomputeAccepted() : null;
      revealIdx = 1;
      // No side accepts (e.g. all boxes unchecked): nothing to play back.
      if (rejectActive() && !fullTrail) { phase = 'idle'; }
    }

    if (dropBtn) dropBtn.addEventListener('click', startWalk);
    if (clearBtn) clearBtn.addEventListener('click', goIdle);

    // Which boundary sides a walk is allowed to be absorbed on. Walks that
    // exit on a disallowed side are reject-sampled, so only the chosen exits
    // are shown. Studio exposes these as four checkboxes; the ?ibrownexport
    // hack drops the bottom edge.
    const allowedSides = { top: true, right: true, bottom: true, left: true };
    if (EXPORT) allowedSides.bottom = false;
    if (STUDIO) {
      ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        const cb = root.querySelector('[data-role="side-' + side + '"]');
        if (!cb) return;
        allowedSides[side] = cb.checked;
        cb.addEventListener('change', function () { allowedSides[side] = cb.checked; });
      });
    }

    // True while some side is disallowed, so walks are being reject-sampled.
    // In this mode the accepted walk is precomputed and played back (see
    // startWalk / revealStep), so the discarded search never shows. Not
    // applied in the ?ibrownexport capture, which walks live as before.
    function rejectActive() {
      return !EXPORT && !(allowedSides.top && allowedSides.right &&
        allowedSides.bottom && allowedSides.left);
    }

    // Sides crossed by a step that exited the unit square. A corner exit
    // touches two sides; the walk is accepted if either is allowed.
    function exitSides(nx, ny) {
      const s = [];
      if (ny <= 0) s.push('bottom');
      if (ny >= 1) s.push('top');
      if (nx <= 0) s.push('left');
      if (nx >= 1) s.push('right');
      return s;
    }

    function gauss() {
      const u1 = Math.max(1e-9, Math.random());
      const u2 = Math.random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    // Simulate one full walk from the start point to its absorption, all at
    // once. Returns the trail (including the clamped landing point) if it
    // exits on an allowed side, or null if it should be rejected.
    function simulateWalk() {
      let p = START.slice();
      const tr = [p.slice()];
      for (let i = 0; i < 20000; i++) {
        let nx = p[0] + gauss() * STEP;
        let ny = p[1] + gauss() * STEP;
        if (nx <= 0 || nx >= 1 || ny <= 0 || ny >= 1) {
          if (!exitSides(nx, ny).some(function (s) { return allowedSides[s]; })) return null;
          nx = Math.max(0, Math.min(1, nx));
          ny = Math.max(0, Math.min(1, ny));
          tr.push([nx, ny]);
          return tr;
        }
        p = [nx, ny];
        tr.push(p.slice());
      }
      return null; // ran away without exiting (extremely unlikely)
    }

    // Reject-sample full walks until one lands on an allowed side. Cheap:
    // a single walk is a few hundred steps and acceptance is generous, so
    // this returns in well under a millisecond. Bounded so an all-sides-off
    // configuration can't spin forever.
    function precomputeAccepted() {
      for (let a = 0; a < 5000; a++) {
        const tr = simulateWalk();
        if (tr) return tr;
      }
      return null;
    }

    // Play back one step of the precomputed accepted walk.
    function revealStep(t) {
      if (!fullTrail || revealIdx >= fullTrail.length) return;
      pos = fullTrail[revealIdx].slice();
      trail.push(pos.slice());
      revealIdx++;
      if (revealIdx >= fullTrail.length) {
        landedAt = pos.slice();
        landedT = t;
        phase = 'landed';
        positionLabel();
      }
    }

    // `t` is the tick clock (virtual time from U.animLoop). landedT is
    // compared against it for the auto-restart delay, so it must be
    // stamped from the same clock — performance.now() runs ahead of it
    // by the figure's total off-screen time, which would push the
    // restart out indefinitely (walk lands and never drops again).
    function step(t) {
      if (phase !== 'walking') return;
      let nx = pos[0] + gauss() * STEP;
      let ny = pos[1] + gauss() * STEP;
      if (nx <= 0 || nx >= 1 || ny <= 0 || ny >= 1) {
        // Reject walks absorbed on a disallowed side; restart from the
        // origin so only the chosen exits are shown.
        if (!exitSides(nx, ny).some(function (s) { return allowedSides[s]; })) {
          pos = START.slice();
          trail = [pos.slice()];
          return;
        }
        nx = Math.max(0, Math.min(1, nx));
        ny = Math.max(0, Math.min(1, ny));
        pos = [nx, ny];
        trail.push(pos.slice());
        landedAt = pos.slice();
        landedT = t;
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
      hitLabelPos = [lx, ly];
      placeLabel(label, lx, ly);
      label.style.opacity = '1';
    }

    function drawTrail() {
      if (trail.length < 2) return;
      ctx.save();
      ctx.strokeStyle = theme.textMuted;
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

      ctx.save();
      if (W.WoDS.captureMode) ctx.translate(0, CAP_SHIFT_Y);
      drawBoundary();
      drawTrail();

      if (phase === 'walking') {
        const dt = t - lastStep;
        const n = Math.min(8, Math.max(1, Math.floor(dt / 4)));
        // Reveal mode: play back a precomputed accepted walk. Live mode:
        // step the stochastic walk directly (only used when no side is
        // rejected, or in the export capture).
        for (let i = 0; i < n; i++) { if (fullTrail) revealStep(t); else step(t); }
        lastStep = t;
      } else if (!STUDIO && phase === 'landed') {
        // Public page: auto-restart a new walk shortly after landing.
        if (t - landedT > 1100) { startWalk(); lastStep = t; }
      }
      // Studio idle/landed: the walk is fully button-driven, including while
      // recording, so you can time the drop against the capture. Capture
      // mode stays on only to render the canvas x / Z_tau labels.

      drawDots();
      if (W.WoDS.captureMode) drawCaptureLabels(t);
      ctx.restore();

      layoutLabels();
      syncLabelVisibility();
    }

    if (STUDIO) goIdle(); else startWalk();
    U.animLoop(root, tick);
  }

  W.WoDS.interactiveBrownian = W.WoDS.lazyFigure(init);
})(window);
