/* Reusable scenes for Interactives 1, 2, 4.
 *
 * "Obstacle counts" map to deterministic precomputed layouts so
 * the slider in Interactive 1 swaps in a stable scene rather than
 * re-randomising. Layouts are seeded by index. */
(function (W) {
  const S = W.WoDS.solver;

  // Outer walls of the unit square: top=+1, bottom=-1, sides=0.
  function outerWalls() {
    return [
      { x0:0, y0:1, x1:1, y1:1, kind:'D', value: 1 },
      { x0:1, y0:0, x1:1, y1:1, kind:'D', value: 0 },
      { x0:0, y0:0, x1:1, y1:0, kind:'D', value:-1 },
      { x0:0, y0:0, x1:0, y1:1, kind:'D', value: 0 },
    ];
  }

  // Seeded LCG for deterministic layouts
  function seedRand(seed) {
    let s = seed | 0 || 1;
    return function () {
      s = (s * 1664525 + 1013904223) | 0;
      return ((s >>> 0) / 4294967296);
    };
  }

  function layout(nObst) {
    const walls = outerWalls();
    const rects = [];
    if (nObst === 0) return { walls, rects };
    const rng = seedRand(7 + nObst * 31);
    let tries = 0;
    while (rects.length < nObst && tries < 400) {
      tries++;
      const w = 0.06 + rng()*0.18;
      const h = 0.04 + rng()*0.10;
      const x0 = 0.07 + rng()*(0.86 - w);
      const y0 = 0.07 + rng()*(0.86 - h);
      const x1 = x0 + w, y1 = y0 + h;
      // No overlap with existing
      let ok = true;
      for (const r of rects) {
        if (!(x1 < r.x0 - 0.04 || x0 > r.x1 + 0.04 ||
              y1 < r.y0 - 0.04 || y0 > r.y1 + 0.04)) { ok = false; break; }
      }
      if (!ok) continue;
      rects.push({ x0, y0, x1, y1, kind:'N' });
    }
    return { walls, rects };
  }

  // Build tile interface segments for an n×n decomposition of [0,1]^2.
  function tileInterfaces(n) {
    const out = [];
    for (let i = 1; i < n; i++) {
      const t = i/n;
      out.push({ x0: t, y0: 0, x1: t, y1: 1 });
      out.push({ x0: 0, y0: t, x1: 1, y1: t });
    }
    return out;
  }

  W.WoDS.scenes = { layout, tileInterfaces };
})(window);
