/* Interactive — absorbing Markov chain on a 1D line.
 *
 * A discrete chain of N_INT transient interior states sandwiched
 * between two absorbing endpoints. The user can:
 *   - drag the boundary values g_L, g_R (the "Dirichlet data")
 *   - drag a per-node bias thumb to reshape transition probabilities
 *   - launch / step / run walks and watch them get absorbed
 *   - toggle "Show exact" to overlay the linear-solve ring
 *
 * As walks accumulate, each transient node's inner fill (MC running
 * mean) catches up to the outer ring (exact solve of (I−Q)u = Rg).
 * The two views are revealed independently so the equivalence is
 * something the user *demonstrates*, not assumes.
 */
(function (W) {
  const U = W.WoDS.util;

  const N_INT = 5;                 // transient interior states
  const N_TOT = N_INT + 2;
  const W0 = 580, H0 = 170;

  const NODE_R = 20;
  const ABS_R  = 22;
  const NODE_Y = 90;

  const BIAS_Y = 142;
  const BIAS_W = 44;
  const BIAS_H = 4;
  const BIAS_MIN = 0.1, BIAS_MAX = 0.9;

  const PAD_X = 50;

  function init(root) {
    const theme = W.WoDS.theme();
    const canvas = root.querySelector('canvas.diagram');
    const ctx = U.fitCanvas(canvas, W0, H0);

    const gLSlider  = root.querySelector('input[data-role="gL"]');
    const gRSlider  = root.querySelector('input[data-role="gR"]');
    const playBtn   = root.querySelector('button[data-role="play"]');
    const stepBtn   = root.querySelector('button[data-role="step"]');
    const resetBtn  = root.querySelector('button[data-role="reset"]');
    const biasBtn   = root.querySelector('button[data-role="reset-bias"]');
    const exactBtn  = root.querySelector('button[data-role="show-exact"]');
    const stat      = root.querySelector('[data-role="status"]');

    // === State ===
    let gL = -1, gR = +1;
    let pRight = new Array(N_INT).fill(0.5);

    let count   = new Float64Array(N_INT);
    let sumAbs  = new Float64Array(N_INT);

    let token = null;
    let running = false;
    let showExact = false;
    let nextRoundRobin = 0;

    // === Geometry ===
    function nodeX(v) {
      return PAD_X + v * ((W0 - 2 * PAD_X) / (N_TOT - 1));
    }
    const ABS_LEFT = 0, ABS_RIGHT = N_TOT - 1;
    function transientVis(i) { return i + 1; }
    function biasX0(i) { return nodeX(transientVis(i)) - BIAS_W / 2; }

    // === Math: tridiagonal Thomas solve for (I − Q) u = R g ===
    function exactSolve() {
      const a = new Array(N_INT), b = new Array(N_INT),
            c = new Array(N_INT), d = new Array(N_INT);
      for (let i = 0; i < N_INT; i++) {
        const pL = 1 - pRight[i], pR = pRight[i];
        a[i] = (i === 0) ? 0 : -pL;
        b[i] = 1;
        c[i] = (i === N_INT - 1) ? 0 : -pR;
        d[i] = 0;
        if (i === 0)         d[i] += pL * gL;
        if (i === N_INT - 1) d[i] += pR * gR;
      }
      for (let i = 1; i < N_INT; i++) {
        const m = a[i] / b[i-1];
        b[i] -= m * c[i-1];
        d[i] -= m * d[i-1];
      }
      const u = new Array(N_INT);
      u[N_INT-1] = d[N_INT-1] / b[N_INT-1];
      for (let i = N_INT - 2; i >= 0; i--) {
        u[i] = (d[i] - c[i] * u[i+1]) / b[i];
      }
      return u;
    }

    function silentWalk(start) {
      let pos = start;
      const cap = 5000;
      for (let s = 0; s < cap; s++) {
        if (Math.random() < pRight[pos]) {
          pos++;
          if (pos >= N_INT) return gR;
        } else {
          pos--;
          if (pos < 0) return gL;
        }
      }
      return 0;
    }

    function recordOutcome(start, value) {
      count[start]  += 1;
      sumAbs[start] += value;
    }
    function meanAt(i) {
      return count[i] > 0 ? sumAbs[i] / count[i] : 0;
    }
    function totalWalks() {
      let n = 0;
      for (let i = 0; i < N_INT; i++) n += count[i];
      return n;
    }
    function rmse() {
      const exact = exactSolve();
      let s = 0, n = 0;
      for (let i = 0; i < N_INT; i++) {
        if (count[i] > 0) {
          const e = meanAt(i) - exact[i];
          s += e * e; n++;
        }
      }
      return n > 0 ? Math.sqrt(s / n) : null;
    }

    function resetStats() {
      count.fill(0);
      sumAbs.fill(0);
      token = null;
    }

    // === Animated walk ===
    const STEP_DUR = 180;
    function startAnimatedWalk(start) {
      token = { start, pos: start, prev: start, t: 0, absorbed: null };
    }
    function tickToken(dt) {
      if (!token) return;
      token.t += dt;
      while (token.t >= STEP_DUR && token.absorbed === null) {
        token.t -= STEP_DUR;
        token.prev = token.pos;
        if (Math.random() < pRight[token.pos]) {
          token.pos++;
          if (token.pos >= N_INT) {
            token.absorbed = gR;
            recordOutcome(token.start, gR);
            scheduleClear();
            return;
          }
        } else {
          token.pos--;
          if (token.pos < 0) {
            token.absorbed = gL;
            recordOutcome(token.start, gL);
            scheduleClear();
            return;
          }
        }
      }
    }
    let clearTimer = null;
    function scheduleClear() {
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        token = null;
        clearTimer = null;
      }, 280);
    }

    // === Rendering ===
    function valueToColor(v) {
      const t = Math.max(0, Math.min(1, (v + 1) * 0.5));
      return U.colormap(t, theme);
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y,     x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x,     y + h, r);
      ctx.arcTo(x,     y + h, x,     y,     r);
      ctx.arcTo(x,     y,     x + w, y,     r);
      ctx.closePath();
    }

    // Arrowhead at (x, y), pointing along angle `ang` (radians).
    function arrowHead(x, y, ang, size) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - size * Math.cos(ang - 0.42),
                 y - size * Math.sin(ang - 0.42));
      ctx.lineTo(x - size * Math.cos(ang + 0.42),
                 y - size * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();
    }

    // A directional transition arrow between two node centers.
    // `srcR`/`dstR` are the radii of the source/destination nodes —
    // the arrow's endpoints sit just outside each node along the
    // top (curve<0) or bottom (curve>0) of the connecting line, so
    // it doesn't overlap the circle.
    function drawArrow(srcX, dstX, srcR, dstR, p, curve) {
      if (p < 0.005) return;
      const w = 1 + 1.6 * p;
      const alpha = 0.35 + 0.5 * p;
      ctx.strokeStyle = `rgba(40,40,40,${alpha.toFixed(3)})`;
      ctx.fillStyle   = `rgba(40,40,40,${alpha.toFixed(3)})`;
      ctx.lineWidth = w;

      // Vertical shoulder where the arrow meets the node — half the
      // curve magnitude, so the curve's two endpoints sit on the top
      // (or bottom) hemisphere of each node.
      const dy = Math.sign(curve) * 4;
      // Place x-endpoints on the circle at that y-shoulder.
      const offSrc = Math.sqrt(Math.max(1, srcR*srcR - dy*dy));
      const offDst = Math.sqrt(Math.max(1, dstR*dstR - dy*dy));
      const dir = Math.sign(dstX - srcX) || 1;
      const x0 = srcX + dir * offSrc;
      const x1 = dstX - dir * offDst;
      const y0 = NODE_Y + dy;
      const y1 = NODE_Y + dy;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2 + curve;

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(mx, my, x1, y1);
      ctx.stroke();

      const tang = Math.atan2(y1 - my, x1 - mx);
      arrowHead(x1, y1, tang, 5);

      // Probability label at the curve's apex, biased outward.
      // Quadratic Bézier midpoint when y0=y1: y_apex = y0 + curve/2.
      const labelX = (x0 + x1) / 2;
      const labelY = y0 + curve * 0.5 + (curve < 0 ? -8 : 8);
      ctx.font = `9px ${theme.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = p.toFixed(2);
      const padX = 3;
      const tw = ctx.measureText(text).width + 2 * padX;
      ctx.fillStyle = theme.surface;
      roundRect(labelX - tw/2, labelY - 7, tw, 14, 2);
      ctx.fill();
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(text, labelX, labelY);
    }

    // Self-loop on an absorbing state: a clear circular loop sitting
    // above the node, entering and exiting from points on its top
    // hemisphere with a small arrowhead at the re-entry.
    function drawSelfLoop(cx, cy) {
      const r = ABS_R;
      const sx = r * 0.42;                  // horizontal half-spread of attachments
      const sy = -Math.sqrt(r*r - sx*sx);   // y of attachments (negative = above center)
      const p1x = cx + sx, p1y = cy + sy;   // exit point (right of top)
      const p2x = cx - sx, p2y = cy + sy;   // re-entry point (left of top)
      // Control points well above the node give a nice rounded loop.
      const lift = r + 24;
      const c1x = cx + r * 0.95, c1y = cy - lift;
      const c2x = cx - r * 0.95, c2y = cy - lift;

      ctx.strokeStyle = 'rgba(40,40,40,0.65)';
      ctx.fillStyle   = 'rgba(40,40,40,0.65)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(p1x, p1y);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2x, p2y);
      ctx.stroke();

      // Arrowhead pointing into the node (tangent at p2 from c2 → p2).
      const ang = Math.atan2(p2y - c2y, p2x - c2x);
      arrowHead(p2x, p2y, ang, 5);

      // Tiny "1" inside the loop to remind that p_self = 1.
      ctx.fillStyle = 'rgba(40,40,40,0.55)';
      ctx.font = `9px ${theme.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('1', cx, cy - r - 6);
    }

    function render() {
      ctx.clearRect(0, 0, W0, H0);
      const exact = exactSolve();

      // 1. Transition arrows between adjacent visual nodes.
      //    Forward (left→right) curves up; backward (right→left)
      //    curves down. Width and opacity track the probability.
      const FWD_CURVE = -10, BWD_CURVE = +10;
      for (let v = 0; v < N_TOT - 1; v++) {
        const xL = nodeX(v), xR = nodeX(v + 1);
        const srcR = (v === ABS_LEFT)  ? ABS_R : NODE_R;
        const dstR = (v + 1 === ABS_RIGHT) ? ABS_R : NODE_R;

        // forward (source = visual v)
        let pFwd = 0;
        if (v >= 1 && v <= N_INT) pFwd = pRight[v - 1];

        // backward (source = visual v+1)
        let pBwd = 0;
        if (v + 1 >= 1 && v + 1 <= N_INT) pBwd = 1 - pRight[v];

        if (pFwd > 0) drawArrow(xL, xR, srcR, dstR, pFwd, FWD_CURVE);
        if (pBwd > 0) drawArrow(xR, xL, dstR, srcR, pBwd, BWD_CURVE);
      }

      // 2. Self-loops on absorbing endpoints.
      drawSelfLoop(nodeX(ABS_LEFT),  NODE_Y);
      drawSelfLoop(nodeX(ABS_RIGHT), NODE_Y);


      // 3. Absorbing nodes (always colored: their values are *given*).
      const absorbing = [
        [ABS_LEFT,  gL, 'Value'],
        [ABS_RIGHT, gR, 'Value'],
      ];
      for (const [v, val, label] of absorbing) {
        const x = nodeX(v), y = NODE_Y;
        ctx.beginPath();
        ctx.arc(x, y, ABS_R, 0, 2 * Math.PI);
        ctx.fillStyle = valueToColor(val);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = theme.text;
        ctx.stroke();

        ctx.fillStyle = theme.text;
        ctx.font = `600 11px ${theme.fontMono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(label, x, y + ABS_R + 16);
        ctx.font = `10px ${theme.fontMono}`;
        ctx.fillStyle = theme.textMuted;
        ctx.fillText(val.toFixed(2), x, y + ABS_R + 30);
      }

      // 4. Transient nodes.
      //    - Border: always drawn.
      //    - Outer ring (exact solve): only when `showExact` is on.
      //    - Inner fill (MC mean): only after walks have accumulated.
      for (let i = 0; i < N_INT; i++) {
        const v = transientVis(i);
        const x = nodeX(v), y = NODE_Y;
        const hasMC = count[i] > 0;

        // White base
        ctx.beginPath();
        ctx.arc(x, y, NODE_R, 0, 2 * Math.PI);
        ctx.fillStyle = theme.surface;
        ctx.fill();

        // Outer ring (exact)
        if (showExact) {
          ctx.beginPath();
          ctx.arc(x, y, NODE_R, 0, 2 * Math.PI);
          ctx.fillStyle = valueToColor(exact[i]);
          ctx.fill();
        }

        // Inner fill (MC) — only if we have data
        if (hasMC) {
          const innerR = showExact ? NODE_R - 6 : NODE_R - 1;
          ctx.beginPath();
          ctx.arc(x, y, innerR, 0, 2 * Math.PI);
          ctx.fillStyle = valueToColor(meanAt(i));
          ctx.fill();
        }

        // Border
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = theme.text;
        ctx.beginPath();
        ctx.arc(x, y, NODE_R, 0, 2 * Math.PI);
        ctx.stroke();

        // Minimalistic bias slider: a slim track + a small thumb.
        const bx0 = biasX0(i);
        const by  = BIAS_Y;
        ctx.fillStyle = '#ececea';
        roundRect(bx0, by - BIAS_H/2, BIAS_W, BIAS_H, BIAS_H/2);
        ctx.fill();
        const t = (pRight[i] - BIAS_MIN) / (BIAS_MAX - BIAS_MIN);
        const tx = bx0 + t * BIAS_W;
        ctx.beginPath();
        ctx.arc(tx, by, 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = theme.text;
        ctx.fill();
      }

      // 4b. Caption under the bias-slider row.
      ctx.fillStyle = theme.textMuted;
      ctx.font = `10px ${theme.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('probabilities', W0 / 2, BIAS_Y + 18);

      // 5. Token (animated walk).
      if (token) {
        let x, y;
        if (token.absorbed !== null) {
          const v = token.pos < 0 ? ABS_LEFT : ABS_RIGHT;
          x = nodeX(v);
          y = NODE_Y - ABS_R - 14;
        } else {
          const a = Math.min(1, token.t / STEP_DUR);
          const xPrev = nodeX(transientVis(token.prev));
          const xCur  = nodeX(transientVis(token.pos));
          x = xPrev + (xCur - xPrev) * a;
          y = NODE_Y - NODE_R - 14 - 8 * Math.sin(a * Math.PI);
        }
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = theme.walk;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

    }

    // === Interaction ===
    let drag = null;
    function pickAt(mx, my) {
      for (let i = 0; i < N_INT; i++) {
        const bx0 = biasX0(i);
        if (mx >= bx0 - 8 && mx <= bx0 + BIAS_W + 8
            && my >= BIAS_Y - 12 && my <= BIAS_Y + 12) {
          return { kind: 'bias', i };
        }
      }
      for (let i = 0; i < N_INT; i++) {
        const v = transientVis(i);
        const dx = mx - nodeX(v), dy = my - NODE_Y;
        if (dx*dx + dy*dy <= NODE_R * NODE_R) {
          return { kind: 'launch', i };
        }
      }
      return null;
    }
    function setBias(i, mx) {
      const bx0 = biasX0(i);
      const t = Math.max(0, Math.min(1, (mx - bx0) / BIAS_W));
      pRight[i] = BIAS_MIN + t * (BIAS_MAX - BIAS_MIN);
      resetStats();
    }
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const hit = pickAt(mx, my);
      if (!hit) return;
      if (hit.kind === 'bias') {
        drag = hit;
        canvas.setPointerCapture(e.pointerId);
        setBias(hit.i, mx);
      } else if (hit.kind === 'launch') {
        startAnimatedWalk(hit.i);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      if (drag.kind === 'bias') setBias(drag.i, e.clientX - r.left);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (drag) {
        try { canvas.releasePointerCapture(e.pointerId); } catch(_){}
        drag = null;
      }
    });

    // === Side controls ===
    gLSlider.addEventListener('input', () => {
      gL = parseFloat(gLSlider.value);
      resetStats();
    });
    gRSlider.addEventListener('input', () => {
      gR = parseFloat(gRSlider.value);
      resetStats();
    });
    biasBtn.addEventListener('click', () => {
      pRight.fill(0.5);
      resetStats();
    });
    resetBtn.addEventListener('click', resetStats);
    stepBtn.addEventListener('click', () => {
      startAnimatedWalk(Math.floor(Math.random() * N_INT));
    });
    playBtn.addEventListener('click', () => {
      running = !running;
      playBtn.textContent = running ? 'Pause walks' : 'Run walks';
    });
    if (exactBtn) {
      exactBtn.addEventListener('click', () => {
        showExact = !showExact;
        exactBtn.textContent = showExact ? 'Hide exact solve' : 'Show exact solve';
      });
    }

    function updateStat() {
      const n = totalWalks();
      const r = rmse();
      const rs = r === null ? '—' : r.toFixed(3);
      stat.textContent = `walks: ${n}   |   RMSE(MC, exact): ${rs}`;
    }

    // === Main loop ===
    let lastT = performance.now();
    function frame(now) {
      const dt = Math.min(50, now - lastT);
      lastT = now;
      tickToken(dt);
      if (running) {
        const K = 80;
        for (let k = 0; k < K; k++) {
          const start = nextRoundRobin;
          nextRoundRobin = (nextRoundRobin + 1) % N_INT;
          recordOutcome(start, silentWalk(start));
        }
      }
      render();
      updateStat();
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  W.WoDS.interactiveMarkov = init;
})(window);
