/* Interactive Dirichlet — paint the boundary, see the harmonic extension.
 *
 * The user clicks/drags on a square. If their cursor is within
 * `brushReach` of the perimeter we treat it as painting boundary
 * values; we map the projected perimeter parameter to a grid cell
 * tag/value pair (Dirichlet, value = current brush value). After
 * each modification we run a few hundred Jacobi sweeps to relax
 * the harmonic extension on a small interior grid.
 */
(function (W) {
  const U = W.WoDS.util;
  const L = W.WoDS.laplace;

  function init(root) {
    const theme = W.WoDS.theme();
    const N = 60;
    const size = 320;

    const canvas = root.querySelector('canvas.diagram');
    const ctx = U.fitCanvas(canvas, size, size);
    const valSlider = root.querySelector('input[data-role="brush"]');
    const valLabel  = root.querySelector('[data-role="brush-val"]');
    const resetBtn  = root.querySelector('button[data-role="reset"]');
    const presetsDiv = root.querySelector('[data-role="presets"]');

    // Boundary band: a strip several cells deep, tagged Dirichlet.
    // Visual band-edge and click hit-test both align to the *same*
    // pixel boundary so there is no mismatch between what the user
    // sees and what they're painting on.
    const bandCells = 5;
    const cellPx = size / N;
    const bandPx = bandCells * cellPx;

    const grid = L.makeGrid(N);

    // Pre-initialised boundary values to suggest the interaction:
    // top edge hot (+1), bottom edge cold (−1), sides interpolated.
    function presetValue(i, j) {
      return -1 + 2 * (j / (N - 1));
    }

    function isBandCell(i, j) {
      return i < bandCells || i >= N - bandCells
          || j < bandCells || j >= N - bandCells;
    }

    // Arc-length along the perimeter, in pixels. The four sides are
    // chained CCW starting at the bottom-left corner; total = 4·size.
    // For each band cell we use the *tangent* coordinate of its
    // assigned edge, so cells along the normal direction inside the
    // band map to the same arc-length and therefore receive the same
    // painted value.
    const PERIMETER = 4 * size;
    function cellArc(i, j) {
      const dB = j, dT = N - 1 - j, dL = i, dR = N - 1 - i;
      const m = Math.min(dB, dT, dL, dR);
      const cx = (i + 0.5) * cellPx;
      const cy = (j + 0.5) * cellPx; // math y (j=0 is bottom)
      if (m === dB) return cx;
      if (m === dR) return size + cy;
      if (m === dT) return 2*size + (size - cx);
      return 3*size + (size - cy);
    }
    function cursorArc(mx, my) {
      // mx,my in canvas pixels (y-down); convert to math y.
      const mathX = mx, mathY = size - my;
      const dB = mathY, dT = size - mathY, dL = mathX, dR = size - mathX;
      const m = Math.min(dB, dT, dL, dR);
      if (m === dB) return mathX;
      if (m === dR) return size + mathY;
      if (m === dT) return 2*size + (size - mathX);
      return 3*size + (size - mathY);
    }
    function arcDist(a, b) {
      const d = Math.abs(a - b);
      return Math.min(d, PERIMETER - d);
    }

    function applyPreset(fn) {
      grid.u.fill(0);
      grid.tag.fill(L.F);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          if (isBandCell(i, j)) {
            const k = j*N+i;
            grid.tag[k] = L.D;
            const v = fn(i, j);
            grid.u[k] = Math.max(-1, Math.min(1, v));
          }
        }
      }
      relax(600);
      render();
    }

    function resetBoundary() { applyPreset(presetValue); }

    function relax(iters) { L.solve(grid, iters); }

    function render() {
      ctx.clearRect(0, 0, size, size);
      const cell = size / N;
      // Heatmap for interior cells
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j*N+i;
          const v = grid.u[k];
          const t = (v + 1) * 0.5; // [-1,1] -> [0,1]
          ctx.fillStyle = U.colormap(t, theme);
          // y axis flipped (canvas y down, math y up)
          ctx.fillRect(i*cell, (N-1-j)*cell, cell+0.5, cell+0.5);
        }
      }
      // Boundary band overlay. Two visual cues:
      //   1. A subtle dim tint on the band area, drawn as four
      //      side strips — distinguishes "boundary" from "interior".
      //   2. A bold dashed line at the inner edge of the band
      //      marking the brushable region.
      ctx.save();
      // Dim the band area
      ctx.fillStyle = 'rgba(17,17,17,0.07)';
      ctx.fillRect(0, 0, size, bandPx);                       // top
      ctx.fillRect(0, size - bandPx, size, bandPx);           // bottom
      ctx.fillRect(0, bandPx, bandPx, size - 2*bandPx);       // left
      ctx.fillRect(size - bandPx, bandPx, bandPx, size - 2*bandPx); // right

      // Inner edge of the band — solid, muted. Dashes are reserved for
      // Neumann (reflecting) boundaries site-wide, so the Dirichlet band
      // uses a solid guide line to avoid reading as a Neumann boundary.
      ctx.strokeStyle = 'rgba(17,17,17,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bandPx + 0.5, bandPx + 0.5, size - 2*bandPx - 1, size - 2*bandPx - 1);

      // Outer frame
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0.75, 0.75, size - 1.5, size - 1.5);

      // Labels rendered as pills so they stay readable on top of
      // any heatmap color underneath.
      drawPill('boundary (paint here)', 6, 6);
      drawPill('interior  Δu = 0', bandPx + 6, bandPx + 6);
      ctx.restore();
    }

    function drawPill(text, x, y) {
      ctx.font = `11px ${theme.fontMono}`;
      const padX = 6, padY = 3;
      const w = ctx.measureText(text).width + padX * 2;
      const h = 16;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(17,17,17,0.35)';
      ctx.lineWidth = 1;
      const r = 3;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.fillText(text, x + padX, y + padY + 9);
    }

    function updateLabel() {
      const v = parseFloat(valSlider.value);
      const sign = v >= 0 ? '+' : '−';
      valLabel.textContent = `${sign}${Math.abs(v).toFixed(2)}`;
    }

    // Paint as a 1D brush along the perimeter arc. All cells inside
    // the band that share the same tangent coordinate receive the
    // same value — i.e. the painted value replicates along the
    // inward normal, exactly as Dirichlet boundary data should.
    function paintAt(mx, my) {
      // Reject clicks well past the inner edge of the band (with a
      // small slop so the brush still fires right at the inner edge).
      const slop = 4;
      const dL = mx, dR = size - mx, dB = my, dT = size - my;
      const minEdge = Math.min(dL, dR, dB, dT);
      if (minEdge > bandPx + slop) return false;

      const v = parseFloat(valSlider.value);
      const sCursor = cursorArc(mx, my);
      const radArc = bandPx * 1.4;

      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j*N+i;
          if (grid.tag[k] !== L.D) continue;
          const sCell = cellArc(i, j);
          const d = arcDist(sCell, sCursor);
          if (d < radArc) {
            const w = 1 - d / radArc;
            grid.u[k] = Math.max(-1, Math.min(1, grid.u[k]*(1-w) + v*w));
          }
        }
      }
      return true;
    }

    let dragging = false;
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      if (paintAt(e.clientX - r.left, e.clientY - r.top)) {
        relax(60); render();
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = canvas.getBoundingClientRect();
      if (paintAt(e.clientX - r.left, e.clientY - r.top)) {
        relax(40); render();
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(_){}
      relax(200); render();
    });
    // Preset boundaries: each is a function (i, j) -> value in [-1, 1]
    // applied to band cells. They're written in terms of perimeter
    // arc-length where useful so the value is constant along the
    // inward normal — same invariant as the brush.
    const presets = [
      { name: 'Top–bottom',
        fn: (i, j) => -1 + 2 * (j / (N - 1)) },
      { name: 'Diagonal',
        fn: (i, j) => -1 + 2 * ((i + j) / (2*(N - 1))) },
      { name: 'Hot top, cold bottom',
        fn: (i, j) => {
          const dB = j, dT = N - 1 - j, dL = i, dR = N - 1 - i;
          const m = Math.min(dB, dT, dL, dR);
          if (m === dT) return  1;
          if (m === dB) return -1;
          return 0;
        }},
      { name: 'Wave',
        fn: (i, j) => Math.sin(2 * Math.PI * 2 * cellArc(i, j) / PERIMETER) },
      { name: 'Hot spot',
        fn: (i, j) => {
          const center = 2.5 * size; // middle of the top edge
          const d = arcDist(cellArc(i, j), center);
          return Math.exp(-(d*d) / Math.pow(size * 0.18, 2));
        }},
      { name: 'Quadrupole',
        fn: (i, j) => Math.sin(2 * Math.PI * 4 * cellArc(i, j) / PERIMETER) },
    ];

    presets.forEach((p) => {
      const b = document.createElement('button');
      b.title = p.name;
      b.appendChild(buildThumbnail(p.fn, 40));
      b.addEventListener('click', () => applyPreset(p.fn));
      presetsDiv.appendChild(b);
    });

    // Build a small precomputed heatmap of the preset's solution.
    // We reuse the high-res Laplace solver and downsample to keep
    // the thumbnail visually faithful — costs ~10ms per preset.
    function buildThumbnail(fn, px) {
      const tg = L.makeGrid(N);
      for (let jj = 0; jj < N; jj++) {
        for (let ii = 0; ii < N; ii++) {
          if (isBandCell(ii, jj)) {
            const k = jj*N+ii;
            tg.tag[k] = L.D;
            tg.u[k] = Math.max(-1, Math.min(1, fn(ii, jj)));
          }
        }
      }
      L.solve(tg, 500);

      const c = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      c.width = px * dpr;
      c.height = px * dpr;
      c.style.width = px + 'px';
      c.style.height = px + 'px';
      const cx = c.getContext('2d');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let py = 0; py < px; py++) {
        for (let pxn = 0; pxn < px; pxn++) {
          const x = (pxn + 0.5) / px;
          const y = 1 - (py + 0.5) / px;
          const ii = Math.min(N-1, Math.max(0, Math.floor(x * N)));
          const jj = Math.min(N-1, Math.max(0, Math.floor(y * N)));
          const v = tg.u[jj*N + ii];
          const t = (v + 1) * 0.5;
          cx.fillStyle = U.colormap(t, theme);
          cx.fillRect(pxn, py, 1.05, 1.05);
        }
      }
      return c;
    }

    resetBtn.addEventListener('click', resetBoundary);
    valSlider.addEventListener('input', updateLabel);

    updateLabel();
    resetBoundary();
  }

  W.WoDS.interactiveDirichlet = init;
})(window);
