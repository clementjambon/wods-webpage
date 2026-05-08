/* Auto-animated absorbing Markov chain (non-interactive).
 *
 * Five states arranged left-to-right: a_L (absorbing), t_1, t_2, t_3
 * (transient), a_R (absorbing). A small swarm of walkers hops to a
 * random neighbor each step. The two absorbing states carry self-loops
 * (the defining property: once entered, the walker never leaves). On
 * arrival at an absorbing state the token traces the self-loop, fades
 * out, and a new walker is released at a random transient state.
 */
(function (W) {
  const N_T = 3;
  const N = N_T + 2;
  const ABS_L = 0, ABS_R = N - 1;

  const VBW = 760, VBH = 200;
  const PAD = 100;
  const NODE_Y = 110;
  const NODE_R = 24;

  const STEP_MS = 700;
  const ABSORB_PAUSE_MS = 1100;
  const N_WALKERS = 3;

  function nodeX(i) {
    return PAD + i * ((VBW - 2 * PAD) / (N - 1));
  }
  function isTransient(i) { return i >= 1 && i <= N_T; }

  function init(root) {
    const theme = W.WoDS.theme();
    const stage = root.querySelector('[data-role="stage"]');
    if (!stage) return;
    stage.innerHTML = '';

    const ringAbsorbing = theme.dirichlet;
    const ringTransient = theme.text;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${VBW} ${VBH}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    stage.appendChild(svg);

    const arrowDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    arrowDefs.innerHTML = `
      <marker id="amc-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="${theme.textMuted}"/>
      </marker>
      <marker id="amc-arrow-abs" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="${theme.dirichlet}"/>
      </marker>`;
    svg.appendChild(arrowDefs);

    function drawArc(from, to) {
      const x1 = nodeX(from), x2 = nodeX(to);
      const dir = Math.sign(x2 - x1);
      const yOff = dir > 0 ? -8 : 8;
      const sx = x1 + dir * NODE_R, sy = NODE_Y + yOff;
      const ex = x2 - dir * NODE_R, ey = NODE_Y + yOff;
      const mx = (sx + ex) / 2;
      const my = NODE_Y + (dir > 0 ? -28 : 28);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', theme.textMuted);
      path.setAttribute('stroke-width', '1.2');
      path.setAttribute('marker-end', 'url(#amc-arrow)');
      path.setAttribute('opacity', '0.7');
      svg.appendChild(path);
    }

    // Adjacent-pair edges, both directions.
    for (let i = 0; i < N - 1; i++) {
      drawArc(i, i + 1);
      drawArc(i + 1, i);
    }

    // Self-loop on each absorbing state, drawn on the outer side
    // (left of a_L, right of a_R). Encodes the defining property:
    // an absorbing state always transitions to itself.
    function drawSelfLoop(i) {
      const cx = nodeX(i);
      const dir = (i === ABS_L) ? -1 : 1;
      const sx = cx + dir * (NODE_R - 1), sy = NODE_Y - 6;
      const ex = cx + dir * (NODE_R - 1), ey = NODE_Y + 6;
      const c1x = cx + dir * (NODE_R + 56), c1y = NODE_Y - 38;
      const c2x = cx + dir * (NODE_R + 56), c2y = NODE_Y + 38;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', ringAbsorbing);
      path.setAttribute('stroke-width', '1.6');
      path.setAttribute('marker-end', 'url(#amc-arrow-abs)');
      path.setAttribute('opacity', '0.85');
      svg.appendChild(path);
    }
    drawSelfLoop(ABS_L);
    drawSelfLoop(ABS_R);

    // Nodes — unified visual: white fill, ring color encodes the type
    // (transient = neutral text color, absorbing = accent ring).
    function drawNode(i) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', nodeX(i));
      c.setAttribute('cy', NODE_Y);
      c.setAttribute('r', NODE_R);
      c.setAttribute('fill', theme.surface);
      if (isTransient(i)) {
        c.setAttribute('stroke', ringTransient);
        c.setAttribute('stroke-width', '1.4');
      } else {
        c.setAttribute('stroke', ringAbsorbing);
        c.setAttribute('stroke-width', '2.8');
      }
      svg.appendChild(c);
    }
    for (let i = 0; i < N; i++) drawNode(i);

    // Walker tokens
    const tokens = [];
    for (let i = 0; i < N_WALKERS; i++) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', '5');
      c.setAttribute('fill', theme.walk);
      c.setAttribute('stroke', '#fff');
      c.setAttribute('stroke-width', '1.5');
      svg.appendChild(c);
      tokens.push(c);
    }

    // KaTeX node labels
    const labels = [
      { i: 0, tex: 'a_L' },
      { i: 1, tex: 't_1' },
      { i: 2, tex: 't_2' },
      { i: 3, tex: 't_3' },
      { i: 4, tex: 'a_R' },
    ];
    labels.forEach(({ i, tex }) => {
      const div = document.createElement('div');
      div.className = 'amc-label';
      div.style.left = `${(nodeX(i) / VBW) * 100}%`;
      div.style.top = `${(NODE_Y / VBH) * 100}%`;
      stage.appendChild(div);
      if (window.katex) {
        try { window.katex.render(tex, div, { throwOnError: false }); } catch (e) { }
      } else {
        div.textContent = tex;
      }
    });

    // Legend below the chain.
    const legend = document.createElement('div');
    legend.className = 'amc-legend';
    const gap = `<span style="display:inline-block; width:18px;"></span>`;
    legend.innerHTML =
      `<span class="amc-swatch" style="border-color:${ringAbsorbing}; border-width:2.4px;"></span>` +
      `&nbsp;Absorbing State` + gap +
      `<span class="amc-swatch" style="border-color:${ringTransient};"></span>` +
      `&nbsp;Transient State` + gap +
      `<span class="amc-swatch amc-swatch--walker" style="background:${theme.walk}; border-color:#fff;"></span>` +
      `&nbsp;Walker`;
    (stage.parentElement || stage).appendChild(legend);

    // === Simulation ===
    function randomTransient() {
      return 1 + Math.floor(Math.random() * N_T);
    }
    function spawn(now) {
      const start = randomTransient();
      return {
        prev: start,
        cur: start,
        stepStart: now,
        absorbedAt: null,
        firstStep: true, // first interval is a stationary "appear" delay
      };
    }
    const walkers = [];
    const t0 = performance.now();
    for (let k = 0; k < N_WALKERS; k++) {
      const w = spawn(t0 + Math.random() * STEP_MS);
      walkers.push(w);
    }

    function nextNeighbor(i) {
      if (i === 1) return Math.random() < 0.5 ? 0 : 2;
      if (i === N_T) return Math.random() < 0.5 ? N_T - 1 : N_T + 1;
      return Math.random() < 0.5 ? i - 1 : i + 1;
    }

    function tokenPos(w, now) {
      if (w.prev === w.cur) {
        // First step (just spawned): hold at the node.
        return { x: nodeX(w.cur), y: NODE_Y };
      }
      const a = Math.min(1, (now - w.stepStart) / STEP_MS);
      const e = a < 0.5 ? 2 * a * a : 1 - Math.pow(-2 * a + 2, 2) / 2;
      const x1 = nodeX(w.prev), x2 = nodeX(w.cur);
      const x = x1 + (x2 - x1) * e;
      const arc = -12 * Math.sin(a * Math.PI);
      return { x, y: NODE_Y + arc };
    }

    function tick(now) {
      for (let k = 0; k < walkers.length; k++) {
        const w = walkers[k];
        if (w.absorbedAt !== null) {
          if (now - w.absorbedAt > ABSORB_PAUSE_MS) {
            walkers[k] = spawn(now);
          }
        } else if (now - w.stepStart >= STEP_MS) {
          w.prev = w.cur;
          w.cur = nextNeighbor(w.prev);
          w.stepStart = now;
          w.firstStep = false;
          if (!isTransient(w.cur)) {
            w.absorbedAt = now;
          }
        }
      }
      for (let k = 0; k < walkers.length; k++) {
        const p = tokenPos(walkers[k], now);
        tokens[k].setAttribute('cx', p.x);
        tokens[k].setAttribute('cy', p.y);
        tokens[k].setAttribute('opacity',
          walkers[k].absorbedAt !== null
            ? Math.max(0, 1 - (now - walkers[k].absorbedAt) / ABSORB_PAUSE_MS)
            : 1);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  W.WoDS = W.WoDS || {};
  W.WoDS.autoMarkov = init;
})(window);
