/* Interactive — N = T x B trade-off (Section 6.3, Figure 11).
 *
 * Two side-by-side panels at fixed output resolution N:
 *   Left:  stage-3 view (interface collocation values) for the current
 *          (T, B) split — a single circle obstacle, fixed boundary
 *          values (top hot, bottom cold).
 *   Right: log-log plot of global-solve system size (= N^2 / B) vs B,
 *          with a marker at the current B.
 *
 * A single slider sweeps B over divisors of N, with T = N / B. Moving
 * it interpolates between the grid-like extreme (T=N, B=1) and the
 * pure solution-operator extreme (T=1, B=N).
 */
(function (W) {
  const U = W.WoDS.util;
  const L = W.WoDS.laplace;

  const N = 64;
  // B values: powers of two dividing N, including the two extremes.
  const B_VALUES = [1, 2, 4, 8, 16, 32, 64];
  // Single fixed scene + boundary preset for the minimal version.
  const SCENE = { circles: [{ cx: 0.5, cy: 0.5, r: 0.18 }], rects: [] };
  const BC_FN = (i, j, Nf) => -1 + 2 * (j / (Nf - 1)); // top hot, bottom cold

  function init(root) {
    const theme = W.WoDS.theme();
    const size = 320;
    const cLeft = root.querySelector('canvas[data-role="domain"]');
    const cRight = root.querySelector('canvas[data-role="plot"]');
    const ctxL = U.fitCanvas(cLeft, size, size);
    const ctxR = U.fitCanvas(cRight, size, size);

    const slider = root.querySelector('input[data-role="b-slider"]');
    const bLabel = root.querySelector('[data-role="b-label"]');
    const tLabel = root.querySelector('[data-role="t-label"]');
    const dofsLabel = root.querySelector('[data-role="dofs-label"]');

    slider.min = '0';
    slider.max = String(B_VALUES.length - 1);
    slider.step = '1';

    let bIdx = parseInt(slider.value);
    if (isNaN(bIdx)) bIdx = 2;
    bIdx = Math.max(0, Math.min(B_VALUES.length - 1, bIdx));

    // ---- Geometry helpers ----------------------------------------
    function isInsideObstacle(x, y) {
      for (const c of SCENE.circles) if (Math.hypot(x - c.cx, y - c.cy) < c.r) return true;
      for (const r of SCENE.rects) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
      return false;
    }

    // ---- FD reference solve (cached, computed once) --------------
    let grid = null;
    function solve() {
      if (grid) return grid;
      const g = L.makeGrid(N);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j * N + i;
          const x = (i + 0.5) / N;
          const y = (j + 0.5) / N;
          const onBand = (i === 0 || i === N - 1 || j === 0 || j === N - 1);
          if (onBand) {
            g.tag[k] = L.D;
            g.u[k] = Math.max(-1, Math.min(1, BC_FN(i, j, N)));
          } else if (isInsideObstacle(x, y)) {
            g.tag[k] = L.N;
            g.u[k] = 0;
          } else {
            g.tag[k] = L.F;
            g.u[k] = 0;
          }
        }
      }
      L.solve(g, 600);
      grid = g;
      return g;
    }

    function sampleU(x, y) {
      const i = Math.min(N - 1, Math.max(0, Math.floor(x * N)));
      const j = Math.min(N - 1, Math.max(0, Math.floor(y * N)));
      return grid.u[j * N + i];
    }

    // ---- Left panel: stage-3 domain view -------------------------
    function px(x) { return x * size; }
    function py(y) { return (1 - y) * size; }

    function drawObstacles() {
      ctxL.save();
      ctxL.fillStyle = 'rgba(42,95,184,0.10)';
      ctxL.strokeStyle = theme.neumann;
      ctxL.lineWidth = 2;
      ctxL.setLineDash([5, 4]);
      for (const c of SCENE.circles) {
        ctxL.beginPath();
        ctxL.arc(px(c.cx), py(c.cy), c.r * size, 0, Math.PI * 2);
        ctxL.fill(); ctxL.stroke();
      }
      ctxL.restore();
    }

    function drawTileInterfaces(T) {
      if (T < 2) return;
      ctxL.save();
      ctxL.strokeStyle = theme.interface;
      ctxL.lineWidth = 1.4;
      ctxL.globalAlpha = 0.85;
      for (let i = 1; i < T; i++) {
        const t = i / T;
        ctxL.beginPath();
        ctxL.moveTo(px(t), py(0)); ctxL.lineTo(px(t), py(1));
        ctxL.moveTo(px(0), py(t)); ctxL.lineTo(px(1), py(t));
        ctxL.stroke();
      }
      ctxL.restore();
    }

    function drawCollocationDot(x, y, value, sizePx) {
      if (isInsideObstacle(x, y)) return;
      const t = (Math.max(-1, Math.min(1, value)) + 1) * 0.5;
      ctxL.fillStyle = U.colormap(t, theme);
      ctxL.strokeStyle = 'rgba(0,0,0,0.45)';
      ctxL.lineWidth = 0.6;
      ctxL.beginPath();
      ctxL.arc(px(x), py(y), sizePx, 0, Math.PI * 2);
      ctxL.fill(); ctxL.stroke();
    }

    function drawInterfaceCollocation(T, B) {
      if (T < 2) return;
      const dotR = Math.max(1.6, Math.min(4.5, size / (N * 2.6)));
      // Vertical interior interfaces
      for (let i = 1; i < T; i++) {
        const x = i / T;
        for (let k = 0; k < N; k++) {
          const y = (k + 0.5) / N;
          drawCollocationDot(x, y, sampleU(x, y), dotR);
        }
      }
      // Horizontal interior interfaces
      for (let i = 1; i < T; i++) {
        const y = i / T;
        for (let k = 0; k < N; k++) {
          const x = (k + 0.5) / N;
          drawCollocationDot(x, y, sampleU(x, y), dotR);
        }
      }
    }

    function drawOuterBoundary() {
      ctxL.save();
      ctxL.strokeStyle = theme.dirichlet;
      ctxL.lineWidth = 3;
      ctxL.strokeRect(1.5, 1.5, size - 3, size - 3);
      ctxL.restore();
    }

    function renderLeft() {
      const B = B_VALUES[bIdx];
      const T = N / B;
      ctxL.clearRect(0, 0, size, size);
      ctxL.fillStyle = theme.surface;
      ctxL.fillRect(0, 0, size, size);
      drawObstacles();
      drawTileInterfaces(T);
      drawInterfaceCollocation(T, B);
      drawOuterBoundary();
    }

    // ---- Right panel: log-log system-size plot -------------------
    const PLOT = { left: 56, right: 14, top: 22, bottom: 44 };

    function fmtPow10(p) {
      // Render 10^p with a small superscript.
      if (p === 0) return '1';
      return '10^' + p;
    }

    function renderRight() {
      const W_ = size, H_ = size;
      ctxR.clearRect(0, 0, W_, H_);
      ctxR.fillStyle = theme.surface;
      ctxR.fillRect(0, 0, W_, H_);

      const x0 = PLOT.left, x1 = W_ - PLOT.right;
      const y0 = PLOT.top, y1 = H_ - PLOT.bottom;

      const xLogMin = 0;                        // log10(1)
      const xLogMax = Math.log10(N);            // log10(64) ≈ 1.806
      const yLogMin = Math.log10(N);            // min DoFs = N (at B=N)
      const yLogMax = Math.log10(N * N);        // max DoFs = N² (at B=1)

      const xMap = (b) => x0 + (Math.log10(b) - xLogMin) / (xLogMax - xLogMin) * (x1 - x0);
      const yMap = (d) => y1 - (Math.log10(d) - yLogMin) / (yLogMax - yLogMin) * (y1 - y0);

      // Gridlines at integer powers of 10 (y) and at each B value (x).
      ctxR.save();
      ctxR.strokeStyle = theme.gridLine || 'rgba(0,0,0,0.08)';
      ctxR.lineWidth = 1;
      ctxR.setLineDash([2, 3]);
      for (let p = Math.ceil(yLogMin); p <= Math.floor(yLogMax); p++) {
        const y = yMap(Math.pow(10, p));
        ctxR.beginPath(); ctxR.moveTo(x0, y); ctxR.lineTo(x1, y); ctxR.stroke();
      }
      for (const b of B_VALUES) {
        const x = xMap(b);
        ctxR.beginPath(); ctxR.moveTo(x, y0); ctxR.lineTo(x, y1); ctxR.stroke();
      }
      ctxR.restore();

      // Axes
      ctxR.save();
      ctxR.strokeStyle = theme.axis || '#444';
      ctxR.lineWidth = 1.2;
      ctxR.beginPath();
      ctxR.moveTo(x0, y0); ctxR.lineTo(x0, y1); ctxR.lineTo(x1, y1);
      ctxR.stroke();
      ctxR.restore();

      // Reference O(1/B) line — just the same N²/B trace, drawn faint
      // before the markers so the markers sit on top.
      ctxR.save();
      ctxR.strokeStyle = theme.accent || '#2a5fb8';
      ctxR.lineWidth = 2;
      ctxR.beginPath();
      B_VALUES.forEach((b, k) => {
        const x = xMap(b), y = yMap((N * N) / b);
        if (k === 0) ctxR.moveTo(x, y); else ctxR.lineTo(x, y);
      });
      ctxR.stroke();
      ctxR.restore();

      // Markers
      B_VALUES.forEach((b, k) => {
        const x = xMap(b), y = yMap((N * N) / b);
        const isCurrent = (k === bIdx);
        ctxR.beginPath();
        ctxR.fillStyle = isCurrent ? (theme.accent || '#2a5fb8') : '#fff';
        ctxR.strokeStyle = theme.accent || '#2a5fb8';
        ctxR.lineWidth = 1.5;
        ctxR.arc(x, y, isCurrent ? 6.5 : 3.5, 0, Math.PI * 2);
        ctxR.fill(); ctxR.stroke();
      });

      // Tick labels
      ctxR.save();
      ctxR.fillStyle = theme.text || '#222';
      ctxR.font = '11px sans-serif';
      ctxR.textAlign = 'center';
      ctxR.textBaseline = 'top';
      for (const b of B_VALUES) {
        ctxR.fillText(String(b), xMap(b), y1 + 6);
      }
      ctxR.textAlign = 'right';
      ctxR.textBaseline = 'middle';
      for (let p = Math.ceil(yLogMin); p <= Math.floor(yLogMax); p++) {
        ctxR.fillText('10', x0 - 8, yMap(Math.pow(10, p)));
        // small superscript
        ctxR.save();
        ctxR.font = '9px sans-serif';
        ctxR.textAlign = 'left';
        ctxR.textBaseline = 'alphabetic';
        ctxR.fillText(String(p), x0 - 7, yMap(Math.pow(10, p)) - 4);
        ctxR.restore();
      }
      // X / Y axis labels are rendered as KaTeX overlays in the DOM
      // (see positionAxisLabels below).

      // Title with N
      ctxR.textAlign = 'right';
      ctxR.textBaseline = 'top';
      ctxR.font = '11px sans-serif';
      ctxR.fillStyle = theme.textMuted || '#666';
      ctxR.fillText('N = T × B = ' + N, x1, y0 - 16);
      ctxR.restore();
    }

    function updateLabels() {
      const B = B_VALUES[bIdx];
      const T = N / B;
      bLabel.textContent = String(B);
      tLabel.textContent = String(T);
      dofsLabel.textContent = String((N * N) / B);
    }

    function render() {
      solve();
      renderLeft();
      renderRight();
      updateLabels();
    }

    slider.value = String(bIdx);
    slider.addEventListener('input', () => {
      bIdx = parseInt(slider.value);
      render();
    });

    // Render KaTeX in the axis-label overlays. Auto-render typically
    // catches these on page load, but we re-trigger in case init runs
    // before the auto-render onload fires.
    function typesetAxisLabels() {
      if (!window.renderMathInElement) return;
      for (const sel of ['[data-role="x-axis-label"]', '[data-role="y-axis-label"]']) {
        const el = root.querySelector(sel);
        if (el) {
          window.renderMathInElement(el, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
            ],
            throwOnError: false,
          });
        }
      }
    }
    if (window.renderMathInElement) typesetAxisLabels();
    else window.addEventListener('load', typesetAxisLabels);

    render();
  }

  W.WoDS.interactiveTradeoff = init;
})(window);
