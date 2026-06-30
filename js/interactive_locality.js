/* Interactive — locality of solution-operator estimation.
 *
 * Inspired by Figure 16 of the WoDS paper. A T×T tiling is laid over
 * the domain; tiles whose interior intersects the obstacle boundary
 * must have their solution operator estimated with Monte Carlo,
 * while empty tiles share a single closed-form operator (precomputed
 * once across all scenes). The user switches between a handful of
 * preset scenes and adjusts T.
 */
(function (W) {
  const U = W.WoDS.util;

  function init(root) {
    const theme = W.WoDS.themeFor(root);
    const size = 380;
    const canvas = root.querySelector('canvas.diagram');
    const ctx = U.fitCanvas(canvas, size, size);

    const tilesSlider = root.querySelector('input[data-role="tiles"]');
    const tilesLabel = root.querySelector('[data-role="tiles-label"]');
    const mcLabel = root.querySelector('[data-role="mc-label"]');
    const preLabel = root.querySelector('[data-role="pre-label"]');
    const scenePresetsDiv = root.querySelector('[data-role="scene-presets"]');

    // Scenes — circles + rects in [0,1]^2.
    const scenes = [
      {
        name: 'Single circle',
        make: () => ({ circles: [{ cx: 0.5, cy: 0.5, r: 0.20 }], rects: [] }),
      },
      {
        name: 'Two circles',
        make: () => ({
          circles: [
            { cx: 0.32, cy: 0.62, r: 0.13 },
            { cx: 0.68, cy: 0.36, r: 0.16 },
          ],
          rects: [],
        }),
      },
      {
        name: 'Slit barrier',
        make: () => ({
          circles: [],
          rects: [{ x0: 0.18, y0: 0.485, x1: 0.82, y1: 0.515 }],
        }),
      },
      {
        name: 'L-shape',
        make: () => ({
          circles: [],
          rects: [
            { x0: 0.25, y0: 0.25, x1: 0.55, y1: 0.35 },
            { x0: 0.25, y0: 0.25, x1: 0.35, y1: 0.70 },
          ],
        }),
      },
      {
        name: 'Cluster',
        make: () => ({
          circles: [
            { cx: 0.28, cy: 0.30, r: 0.07 },
            { cx: 0.62, cy: 0.22, r: 0.06 },
            { cx: 0.74, cy: 0.66, r: 0.09 },
            { cx: 0.36, cy: 0.72, r: 0.08 },
            { cx: 0.50, cy: 0.48, r: 0.05 },
          ],
          rects: [],
        }),
      },
    ];

    let sceneIdx = 0;
    let T = parseInt(tilesSlider.value);

    // ---- Tile classification ----------------------------------------
    // Returns true iff the tile (axis-aligned square in [0,1]^2) has a
    // non-empty intersection with the *boundary* of any obstacle, i.e.
    // the obstacle is neither fully outside the tile nor fully covering
    // it. These are the tiles whose local solution operator depends on
    // geometry and must be Monte-Carlo–estimated.
    function tileCrossesGeometry(x0, y0, x1, y1, scene) {
      // For each obstacle, check whether the tile both contains some
      // obstacle interior AND some obstacle exterior.
      function tileTouchesInterior(test) {
        // Sample a 4×4 grid inside the tile and the four corners.
        const N = 4;
        for (let i = 0; i <= N; i++) {
          for (let j = 0; j <= N; j++) {
            const x = x0 + (x1 - x0) * (i / N);
            const y = y0 + (y1 - y0) * (j / N);
            if (test(x, y)) return true;
          }
        }
        return false;
      }
      function tileTouchesExterior(test) {
        const N = 4;
        for (let i = 0; i <= N; i++) {
          for (let j = 0; j <= N; j++) {
            const x = x0 + (x1 - x0) * (i / N);
            const y = y0 + (y1 - y0) * (j / N);
            if (!test(x, y)) return true;
          }
        }
        return false;
      }
      for (const c of scene.circles) {
        const inside = (x, y) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r * c.r;
        if (tileTouchesInterior(inside) && tileTouchesExterior(inside)) return true;
      }
      for (const r of scene.rects) {
        const inside = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
        if (tileTouchesInterior(inside) && tileTouchesExterior(inside)) return true;
      }
      return false;
    }

    function classifyTiles(scene, T) {
      const out = [];
      let nMC = 0;
      for (let i = 0; i < T; i++) {
        for (let j = 0; j < T; j++) {
          const x0 = i / T, x1 = (i + 1) / T;
          const y0 = j / T, y1 = (j + 1) / T;
          const mc = tileCrossesGeometry(x0, y0, x1, y1, scene);
          if (mc) nMC++;
          out.push({ i, j, mc });
        }
      }
      return { tiles: out, nMC, total: T * T };
    }

    // ---- Drawing -----------------------------------------------------
    function drawObstacles(cx, scene, pxs) {
      cx.fillStyle = theme.neumannFill;
      cx.strokeStyle = theme.neumann;
      cx.lineWidth = 1.5;
      cx.setLineDash([5, 4]);
      for (const c of scene.circles) {
        cx.beginPath();
        cx.arc(c.cx * pxs, (1 - c.cy) * pxs, c.r * pxs, 0, Math.PI * 2);
        cx.fill(); cx.stroke();
      }
      for (const r of scene.rects) {
        const x = r.x0 * pxs, y = (1 - r.y1) * pxs;
        const w = (r.x1 - r.x0) * pxs, h = (r.y1 - r.y0) * pxs;
        cx.fillRect(x, y, w, h); cx.strokeRect(x, y, w, h);
      }
      cx.setLineDash([]);
    }

    function render() {
      const scene = scenes[sceneIdx].make();
      const { tiles, nMC, total } = classifyTiles(scene, T);

      ctx.clearRect(0, 0, size, size);

      // Tile fills first.
      for (const t of tiles) {
        const x = (t.i / T) * size;
        const y = (1 - (t.j + 1) / T) * size;
        const w = size / T;
        const h = size / T;
        if (t.mc) {
          ctx.fillStyle = 'rgba(255, 196, 0, 0.42)';
        } else {
          ctx.fillStyle = 'rgba(120, 120, 120, 0.06)';
        }
        ctx.fillRect(x, y, w, h);
      }

      // Tile grid lines.
      ctx.strokeStyle = theme.interface;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      for (let k = 1; k < T; k++) {
        const t = (k / T) * size;
        ctx.beginPath(); ctx.moveTo(t, 0); ctx.lineTo(t, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, t); ctx.lineTo(size, t); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Obstacles.
      drawObstacles(ctx, scene, size);

      // Outer Dirichlet boundary.
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.dirichlet;
      ctx.strokeRect(1.5, 1.5, size - 3, size - 3);

      const pct = (n) => total > 0 ? ((100 * n) / total).toFixed(1) + '%' : '—';
      mcLabel.textContent = `${nMC} (${pct(nMC)})`;
      preLabel.textContent = `${total - nMC} (${pct(total - nMC)})`;
    }

    // ---- Scene preset thumbnails ------------------------------------
    function buildSceneThumbnail(sc, pxs) {
      const c = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      c.width = pxs * dpr; c.height = pxs * dpr;
      c.style.width = pxs + 'px'; c.style.height = pxs + 'px';
      const cx = c.getContext('2d');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.fillStyle = theme.surface;
      cx.fillRect(0, 0, pxs, pxs);
      cx.strokeStyle = theme.dirichlet;
      cx.lineWidth = 1.5;
      cx.strokeRect(1, 1, pxs - 2, pxs - 2);
      drawObstacles(cx, sc.make(), pxs);
      return c;
    }

    const sceneButtons = [];
    scenes.forEach((sc, idx) => {
      const b = document.createElement('button');
      b.title = sc.name;
      b.appendChild(buildSceneThumbnail(sc, 40));
      b.addEventListener('click', () => {
        if (idx === sceneIdx) return;
        sceneIdx = idx;
        updateSceneHighlight();
        render();
      });
      scenePresetsDiv.appendChild(b);
      sceneButtons.push(b);
    });
    function updateSceneHighlight() {
      sceneButtons.forEach((b, i) => {
        b.style.borderColor = (i === sceneIdx) ? 'var(--color-accent, #2a5fb8)' : '';
      });
    }
    updateSceneHighlight();

    // ---- Slider ------------------------------------------------------
    tilesSlider.addEventListener('input', () => {
      T = parseInt(tilesSlider.value);
      tilesLabel.textContent = `${T}×${T}`;
      render();
    });
    tilesLabel.textContent = `${T}×${T}`;

    render();
  }

  W.WoDS.interactiveLocality = init;
})(window);
