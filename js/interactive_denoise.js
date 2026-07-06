/* Interactive: denoising the BVP solution.
 *
 * Same square Dirichlet problem as the Brownian figure (g(s)=cos 2πs
 * around the perimeter). Each interior pixel estimates u(x)=E[g(Z_τ)]
 * with Walk on Spheres; averaging many independent walks per pixel
 * denoises the noisy Monte Carlo field into the smooth harmonic
 * solution.
 *
 * It runs continuously: every frame adds more walks per pixel, so the
 * interior denoises on load and then keeps refining without ever
 * stopping. The refresh-rate slider sets how many walks are added per
 * frame; the button pauses/resumes. */
(function (W) {
  const U = W.WoDS.util;

  function init(root) {
    const theme = W.WoDS.themeFor ? W.WoDS.themeFor(root) : W.WoDS.theme();
    const canvas = root.querySelector('canvas.diagram');
    // Blog and studio have separate control markup (a minimal slider below the
    // canvas vs. the full side panel); pick the active one by page.
    const STUDIO = W.WoDS.inStudio;
    // Studio keeps the full panel (pace slider + play/restart). The blog shows
    // a read-only progress slider that self-advances noise → solution.
    const rateSlider = STUDIO ? root.querySelector('.studio-only [data-role="rate-slider"]') : null;
    const rateLabel = root.querySelector('.studio-only [data-role="rate"]');
    const playBtn = STUDIO ? root.querySelector('[data-role="play"]') : null;
    const restartBtn = STUDIO ? root.querySelector('[data-role="restart"]') : null;
    const progressSlider = STUDIO ? null : root.querySelector('.blog-only [data-role="progress"]');
    const sampleLabel = STUDIO ? null : root.querySelector('.blog-only [data-role="sample-count"]');

    const W0 = 380, H0 = 380;
    const ctx = U.fitCanvas(canvas, W0, H0);
    const PAD = 20;
    // The outer square is the outer edge of the boundary-condition band. The
    // interior solution is drawn inset by BW, so the fixed boundary data g
    // reads as a distinct frame around the (noisy) interior being solved —
    // this is what visually disentangles "boundary condition" from "interior".
    const BW = 12;
    const X0 = PAD, Y0 = PAD, X1 = W0 - PAD, Y1 = H0 - PAD;
    const IX0 = X0 + BW, IY0 = Y0 + BW, IX1 = X1 - BW, IY1 = Y1 - BW;
    const ISW = IX1 - IX0, ISH = IY1 - IY0;

    // --- the BVP (identical to the Brownian figure) ---
    function gAtS(s) { return Math.cos(2 * Math.PI * s); }
    function gAtUV(u, v) {
      const eps = 1e-6;
      let s;
      if (v < eps) s = u * 0.25;
      else if (u > 1 - eps) s = 0.25 + v * 0.25;
      else if (v > 1 - eps) s = 0.5 + (1 - u) * 0.25;
      else s = 0.75 + (1 - v) * 0.25;
      return gAtS(s);
    }
    function colorFor(val) { return U.colormap(0.5 + 0.5 * val, theme); }

    // Walk on Spheres estimate of u at an interior point: jump to a
    // random point on the largest inscribed circle until close to the
    // boundary, then return g at the landing point. One call = one
    // sample of g(Z_τ).
    function sampleU(x, y) {
      const eps = 0.002;
      for (let i = 0; i < 256; i++) {
        const r = Math.min(x, 1 - x, y, 1 - y); // dist to square boundary
        if (r < eps) break;
        const a = Math.random() * 6.283185307179586;
        x += r * Math.cos(a);
        y += r * Math.sin(a);
      }
      // Snap to the nearest edge before reading g: the walk halts a small
      // distance *off* the boundary, but gAtUV only classifies a point's
      // edge when a coordinate is exactly 0 or 1.
      const dl = x, dr = 1 - x, db = y, dt = 1 - y;
      const m = Math.min(dl, dr, db, dt);
      if (m === dl) x = 0; else if (m === dr) x = 1; else if (m === db) y = 0; else y = 1;
      return gAtUV(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
    }

    // --- interior field on a regular grid ---
    const G = 44;
    const cell = ISW / G;
    const cxArr = new Float64Array(G * G), cyArr = new Float64Array(G * G);
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        cxArr[j * G + i] = (i + 0.5) / G;
        cyArr[j * G + i] = (j + 0.5) / G;
      }
    }
    const sum = new Float64Array(G * G);
    let cur = 0;       // walks accumulated per pixel so far

    function resetField() { sum.fill(0); cur = 0; }

    function accumulate(passes) {
      for (let p = 0; p < passes; p++) {
        for (let k = 0; k < G * G; k++) sum[k] += sampleU(cxArr[k], cyArr[k]);
        cur++;
      }
    }

    function drawField() {
      if (cur === 0) return;
      const inv = 1 / cur;
      for (let j = 0; j < G; j++) {
        for (let i = 0; i < G; i++) {
          const val = sum[j * G + i] * inv;
          ctx.fillStyle = colorFor(val);
          const sx = IX0 + (i / G) * ISW;
          const sy = IY1 - ((j + 1) / G) * ISH;
          // Slight overdraw so neighbouring cells leave no seam.
          ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(cell) + 1, Math.ceil(cell) + 1);
        }
      }
    }

    // --- boundary band (matches the Brownian figure) ---
    function sideGradient(x0, y0, x1, y1, sStart, sEnd) {
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      const N = 32;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        grad.addColorStop(t, colorFor(gAtS(sStart + (sEnd - sStart) * t)));
      }
      return grad;
    }
    // The boundary condition g drawn as a thick band framing the domain.
    // Stroked along the band midline (inset BW/2 from the outer edge) with
    // square caps so the four corners meet flush. This band is the *given*
    // data; the interior square inside it is what the walks are solving.
    function drawBoundaryBand() {
      const m = BW / 2;
      const ax = X0 + m, ay = Y0 + m, bx = X1 - m, by = Y1 - m;
      ctx.save();
      ctx.lineWidth = BW;
      ctx.lineCap = 'square';
      ctx.strokeStyle = sideGradient(ax, by, bx, by, 0.00, 0.25);
      ctx.beginPath(); ctx.moveTo(ax, by); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = sideGradient(bx, by, bx, ay, 0.25, 0.50);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, ay); ctx.stroke();
      ctx.strokeStyle = sideGradient(bx, ay, ax, ay, 0.50, 0.75);
      ctx.beginPath(); ctx.moveTo(bx, ay); ctx.lineTo(ax, ay); ctx.stroke();
      ctx.strokeStyle = sideGradient(ax, ay, ax, by, 0.75, 1.00);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, by); ctx.stroke();
      ctx.restore();
    }

    // Crisp solid divider between the boundary band and the interior, so the
    // two never blur together (even once the interior converges to g at the
    // edge). Solid — a Dirichlet edge, not a dashed Neumann one.
    function drawDivider() {
      ctx.save();
      ctx.strokeStyle = 'rgba(17,17,17,0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(IX0, IY0, ISW, ISH);
      ctx.restore();
    }

    // --- controls ---
    // Blog: the denoise LOOPS — noise → smooth → brief hold → restart — so a
    // reader scrolling past at any moment always catches some noise. The one
    // slider sets the pace. Studio: runs continuously with manual play/pause
    // and a Restart button, for authoring/recording.
    // Blog: fixed pace (0.5 walks/frame). Studio: from the panel slider.
    let speed = STUDIO ? (rateSlider ? (parseFloat(rateSlider.value) || 1) : 1) : 0.5;
    let playing = true;
    let acc = 0;          // carries the fractional walk remainder
    let holdT = 0;        // (loop) timestamp to restart the noise after the smooth hold

    const LOOP = !STUDIO;
    const TARGET = 120;   // walks/pixel at which the field reads as smooth
    const HOLD_MS = 650;  // dwell on the smooth solution before restarting
    if (progressSlider) progressSlider.max = TARGET; // keep the slider scale in sync

    function syncRate() { if (rateLabel) rateLabel.textContent = String(speed); }
    function syncBtn() { if (playBtn) playBtn.textContent = playing ? '⏸ Pause' : '▶ Play'; }

    if (rateSlider) rateSlider.addEventListener('input', () => {
      speed = parseFloat(rateSlider.value) || 0.25; syncRate();
    });
    if (playBtn) playBtn.addEventListener('click', () => { playing = !playing; syncBtn(); });
    // Restart: clear back to noise and start the denoise over. Preserve
    // the current play/pause state — restarting while paused stays paused
    // on the fresh-noise frame until you press Play.
    if (restartBtn) restartBtn.addEventListener('click', () => { resetField(); acc = 0; accumulate(1); });

    // Add `speed` walks/pixel this frame; fractional speeds add a walk only
    // every few frames via the carried remainder.
    function step() {
      acc += speed;
      const n = Math.floor(acc);
      if (n > 0) { accumulate(n); acc -= n; }
    }

    // --- main loop ---
    function tick(t) {
      if (LOOP) {
        if (holdT) {
          if (t >= holdT) { resetField(); acc = 0; accumulate(1); holdT = 0; }
        } else {
          step();
          if (cur >= TARGET) holdT = t + HOLD_MS; // reached smooth → hold, then restart
        }
      } else if (playing) {
        step();
      }
      // Drive the read-only blog slider + label from the sample count so far.
      if (progressSlider) {
        const s = Math.min(TARGET, Math.round(cur));
        progressSlider.value = s;
        // WebKit has no native range-progress fill; drive it via --fill.
        progressSlider.style.setProperty('--fill', (100 * s / TARGET) + '%');
        if (sampleLabel) sampleLabel.textContent = String(s);
      }
      ctx.clearRect(0, 0, W0, H0);
      drawField();
      drawBoundaryBand();
      drawDivider();
    }

    accumulate(1);
    syncRate();
    syncBtn();
    U.animLoop(root, tick);
  }

  W.WoDS.interactiveDenoise = W.WoDS.lazyFigure(init);
})(window);
