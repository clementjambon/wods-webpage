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
    const rateSlider = root.querySelector('[data-role="rate-slider"]');
    const rateLabel = root.querySelector('[data-role="rate"]');
    const playBtn = root.querySelector('[data-role="play"]');
    const restartBtn = root.querySelector('[data-role="restart"]');

    const W0 = 380, H0 = 380;
    const ctx = U.fitCanvas(canvas, W0, H0);
    const PAD = 22;
    const X0 = PAD, Y0 = PAD, X1 = W0 - PAD, Y1 = H0 - PAD;
    const SW = X1 - X0, SH = Y1 - Y0;

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
    function uvToScreen(u, v) { return [X0 + u * SW, Y1 - v * SH]; }

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
    const cell = SW / G;
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
          const sx = X0 + (i / G) * SW;
          const sy = Y1 - ((j + 1) / G) * SH;
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
    function drawBoundary() {
      ctx.save();
      ctx.lineWidth = 4;
      ctx.lineCap = 'square';
      ctx.strokeStyle = sideGradient(X0, Y1, X1, Y1, 0.00, 0.25);
      ctx.beginPath(); ctx.moveTo(X0, Y1); ctx.lineTo(X1, Y1); ctx.stroke();
      ctx.strokeStyle = sideGradient(X1, Y1, X1, Y0, 0.25, 0.50);
      ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X1, Y0); ctx.stroke();
      ctx.strokeStyle = sideGradient(X1, Y0, X0, Y0, 0.50, 0.75);
      ctx.beginPath(); ctx.moveTo(X1, Y0); ctx.lineTo(X0, Y0); ctx.stroke();
      ctx.strokeStyle = sideGradient(X0, Y0, X0, Y1, 0.75, 1.00);
      ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X0, Y1); ctx.stroke();
      ctx.restore();
    }

    // --- controls ---
    // The figure runs continuously: every frame it adds `speed` more walks
    // per pixel, so the interior denoises on load and then keeps refining
    // forever — no hold, no reset, never stops. The refresh-rate slider
    // sets how many walks are added per frame; the button pauses/resumes.
    let speed = parseFloat(rateSlider.value) || 1;  // walks per frame (may be < 1)
    let playing = true;
    let acc = 0;                                     // carries the fractional remainder

    function syncRate() { if (rateLabel) rateLabel.textContent = String(speed); }
    function syncBtn() { if (playBtn) playBtn.textContent = playing ? '⏸ Pause' : '▶ Play'; }

    rateSlider.addEventListener('input', () => { speed = parseFloat(rateSlider.value) || 0.25; syncRate(); });
    if (playBtn) playBtn.addEventListener('click', () => { playing = !playing; syncBtn(); });
    // Restart: clear back to noise and resume the denoise from scratch.
    if (restartBtn) restartBtn.addEventListener('click', () => { resetField(); acc = 0; accumulate(1); playing = true; syncBtn(); });

    // --- main loop ---
    function tick() {
      if (playing) {
        // Accumulate `speed` walks per frame; fractional speeds add a walk
        // only every few frames via the carried remainder.
        acc += speed;
        const n = Math.floor(acc);
        if (n > 0) { accumulate(n); acc -= n; }
      }
      ctx.clearRect(0, 0, W0, H0);
      drawField();
      drawBoundary();
      requestAnimationFrame(tick);
    }

    accumulate(1);
    syncRate();
    syncBtn();
    requestAnimationFrame(tick);
  }

  W.WoDS.interactiveDenoise = init;
})(window);
