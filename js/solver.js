/* ==============================================================
 * Pure JS Walk on Spheres / Walk on Stars solver.
 *
 * Domain conventions
 *   - The unit square [0,1]^2 with the four outer walls
 *     (configurable per wall, typically Dirichlet).
 *   - A list of axis-aligned interior rectangles, each marked
 *     'D' (Dirichlet, with a value) or 'N' (zero-Neumann).
 *   - Optional Neumann/Dirichlet circles and tile-interface
 *     ('I' = artificial Dirichlet collocation) segments.
 *
 * Two modes:
 *   - 'wost' (default): Walk on Stars (Sawhney et al. 2023).
 *       r = max(rmin, min(d_Dirichlet, d_silhouette)). Sample a
 *       direction; cast a ray; if it first hits the Neumann part
 *       of the star within r, land on it (then sample the next
 *       direction from a hemisphere around the inward normal);
 *       otherwise step to the sphere of radius r.
 *   - 'wos' : the biased reflection approach from §3.4.3 of the
 *       WoSt paper. r = distance to the *nearest* boundary; if
 *       the sphere sample lands within eps of a Neumann surface,
 *       nudge inward along the normal and continue.
 *
 * Mode is selected per call by `scene.mode` (defaults to 'wost').
 * ============================================================== */
(function (W) {
  const C = W.WoDS.config;
  const U = W.WoDS.util;

  // ---- Distance helpers --------------------------------------------------

  function distToWall(px, py, w) {
    if (w.x0 === w.x1) {
      const ymin = Math.min(w.y0, w.y1), ymax = Math.max(w.y0, w.y1);
      if (py < ymin) return Math.hypot(px - w.x0, py - ymin);
      if (py > ymax) return Math.hypot(px - w.x0, py - ymax);
      return Math.abs(px - w.x0);
    }
    const xmin = Math.min(w.x0, w.x1), xmax = Math.max(w.x0, w.x1);
    if (px < xmin) return Math.hypot(px - xmin, py - w.y0);
    if (px > xmax) return Math.hypot(px - xmax, py - w.y0);
    return Math.abs(py - w.y0);
  }

  // Closest boundary of any kind. Used by WoS and for general queries.
  function distToSegments(px, py, scene) {
    let best = Infinity, kind = null, value = 0, normal = [0, 0];

    for (const w of scene.walls) {
      let d, n;
      if (w.x0 === w.x1) {
        if (py < Math.min(w.y0,w.y1) || py > Math.max(w.y0,w.y1)) {
          const eyy = py < Math.min(w.y0,w.y1) ? Math.min(w.y0,w.y1) : Math.max(w.y0,w.y1);
          const dx = px - w.x0, dy = py - eyy;
          d = Math.sqrt(dx*dx+dy*dy);
          n = [dx, dy];
        } else {
          d = Math.abs(px - w.x0); n = [px - w.x0, 0];
        }
      } else {
        if (px < Math.min(w.x0,w.x1) || px > Math.max(w.x0,w.x1)) {
          const exx = px < Math.min(w.x0,w.x1) ? Math.min(w.x0,w.x1) : Math.max(w.x0,w.x1);
          const dx = px - exx, dy = py - w.y0;
          d = Math.sqrt(dx*dx+dy*dy);
          n = [dx, dy];
        } else {
          d = Math.abs(py - w.y0); n = [0, py - w.y0];
        }
      }
      if (d < best) { best = d; kind = w.kind; value = w.value || 0; normal = n; }
    }

    for (const r of scene.rects) {
      const d = U.distToRect(px, py, r.x0, r.y0, r.x1, r.y1);
      if (d < best) {
        best = d; kind = r.kind; value = r.value || 0;
        const cp = U.closestOnRect(px, py, r.x0, r.y0, r.x1, r.y1);
        normal = [px - cp[0], py - cp[1]];
      }
    }

    if (scene.circles) {
      for (const c of scene.circles) {
        const dx = px - c.cx, dy = py - c.cy;
        const r = Math.hypot(dx, dy);
        const d = Math.abs(r - c.r);
        if (d < best) {
          best = d; kind = c.kind; value = c.value || 0;
          const nl = r || 1;
          normal = [dx/nl, dy/nl];
        }
      }
    }

    if (scene.tileInterfaces) {
      for (const t of scene.tileInterfaces) {
        let d, n;
        if (t.x0 === t.x1) {
          if (py < Math.min(t.y0,t.y1) || py > Math.max(t.y0,t.y1)) continue;
          d = Math.abs(px - t.x0); n = [px - t.x0, 0];
        } else {
          if (px < Math.min(t.x0,t.x1) || px > Math.max(t.x0,t.x1)) continue;
          d = Math.abs(py - t.y0); n = [0, py - t.y0];
        }
        if (d < best) { best = d; kind = 'I'; value = 0; normal = n; }
      }
    }

    const nl = Math.hypot(normal[0], normal[1]) || 1;
    normal = [normal[0]/nl, normal[1]/nl];
    return { dist: best, kind, value, normal };
  }

  // Closest Dirichlet (or interface 'I') boundary only.
  function distToDirichlet(px, py, scene) {
    let best = Infinity, value = 0;
    for (const w of scene.walls) {
      if (w.kind !== 'D') continue;
      const d = distToWall(px, py, w);
      if (d < best) { best = d; value = w.value || 0; }
    }
    for (const r of scene.rects) {
      if (r.kind !== 'D') continue;
      const d = U.distToRect(px, py, r.x0, r.y0, r.x1, r.y1);
      if (d < best) { best = d; value = r.value || 0; }
    }
    if (scene.circles) {
      for (const c of scene.circles) {
        if (c.kind !== 'D') continue;
        const d = Math.abs(Math.hypot(px - c.cx, py - c.cy) - c.r);
        if (d < best) { best = d; value = c.value || 0; }
      }
    }
    if (scene.tileInterfaces) {
      for (const t of scene.tileInterfaces) {
        let d;
        if (t.x0 === t.x1) {
          if (py < Math.min(t.y0,t.y1) || py > Math.max(t.y0,t.y1)) continue;
          d = Math.abs(px - t.x0);
        } else {
          if (px < Math.min(t.x0,t.x1) || px > Math.max(t.x0,t.x1)) continue;
          d = Math.abs(py - t.y0);
        }
        if (d < best) { best = d; value = 0; }
      }
    }
    return { dist: best, value };
  }

  // Distance from (px,py) to the closest silhouette point on the Neumann
  // boundary. For axis-aligned Neumann rectangles in 2D, the silhouette
  // points are the rectangle corners (visibility flips between adjacent
  // edges there). Using all four corners is conservative — it can only
  // shrink the star radius, never make it invalid.
  // For Neumann circles, the silhouette is the tangent point from the
  // query, at distance sqrt(d^2 - r^2) where d = |x - center|.
  function silhouetteDist(px, py, scene) {
    let best = Infinity;
    for (const r of scene.rects) {
      if (r.kind !== 'N') continue;
      const xs = [r.x0, r.x1], ys = [r.y0, r.y1];
      for (const cx of xs) for (const cy of ys) {
        const d = Math.hypot(px - cx, py - cy);
        if (d < best) best = d;
      }
    }
    if (scene.circles) {
      for (const c of scene.circles) {
        if (c.kind !== 'N') continue;
        const d = Math.hypot(px - c.cx, py - c.cy);
        if (d > c.r) {
          const t = Math.sqrt(d*d - c.r*c.r);
          if (t < best) best = t;
        }
      }
    }
    return best;
  }

  // First intersection of ray (px,py) + t*(vx,vy), t > 0, with the Neumann
  // boundary, restricted to t < maxT. Returns { t, normal } where normal
  // is the *outward* unit normal of the surface (pointing into the
  // obstacle / away from the domain). t === Infinity if no hit.
  function rayHitNeumann(px, py, vx, vy, maxT, scene) {
    const TEPS = 1e-9;
    let bestT = Infinity, bestN = [0, 0];

    for (const r of scene.rects) {
      if (r.kind !== 'N') continue;

      let txEnter = -Infinity, txExit = Infinity, sxEnter = 0;
      if (vx !== 0) {
        const t1 = (r.x0 - px) / vx, t2 = (r.x1 - px) / vx;
        if (t1 < t2) { txEnter = t1; txExit = t2; sxEnter = -1; }
        else         { txEnter = t2; txExit = t1; sxEnter = +1; }
      } else if (px <= r.x0 || px >= r.x1) {
        continue;
      }

      let tyEnter = -Infinity, tyExit = Infinity, syEnter = 0;
      if (vy !== 0) {
        const t1 = (r.y0 - py) / vy, t2 = (r.y1 - py) / vy;
        if (t1 < t2) { tyEnter = t1; tyExit = t2; syEnter = -1; }
        else         { tyEnter = t2; tyExit = t1; syEnter = +1; }
      } else if (py <= r.y0 || py >= r.y1) {
        continue;
      }

      const tEnter = Math.max(txEnter, tyEnter);
      const tExit  = Math.min(txExit,  tyExit);
      if (tEnter > tExit) continue;
      if (tEnter < TEPS) continue;        // behind us, or self-hit at the surface
      if (tEnter >= maxT) continue;
      if (tEnter < bestT) {
        bestT = tEnter;
        bestN = (txEnter > tyEnter) ? [sxEnter, 0] : [0, syEnter];
      }
    }

    if (scene.circles) {
      for (const c of scene.circles) {
        if (c.kind !== 'N') continue;
        const ox = px - c.cx, oy = py - c.cy;
        const b = ox*vx + oy*vy;          // assumes (vx,vy) unit length
        const cc = ox*ox + oy*oy - c.r*c.r;
        const disc = b*b - cc;
        if (disc < 0) continue;
        const sd = Math.sqrt(disc);
        let t = -b - sd;
        if (t < TEPS) t = -b + sd;
        if (t < TEPS || t >= maxT) continue;
        if (t < bestT) {
          bestT = t;
          const hx = ox + t*vx, hy = oy + t*vy;
          const nl = Math.hypot(hx, hy) || 1;
          bestN = [hx/nl, hy/nl];
        }
      }
    }

    return { t: bestT, normal: bestN };
  }

  // ---- Walks -------------------------------------------------------------

  function walkWoSt(scene, sx, sy, recordPath) {
    let x = sx, y = sy;
    const points = recordPath ? [[x, y]] : null;
    // Star radius r used at each step (one entry per point transition, so
    // radii[i] is the radius of the star region centered at points[i]).
    // Lets the figure render the true star-shaped domain, not just a ball.
    const radii = recordPath ? [] : null;
    const eps = (scene && scene.epsilon != null) ? scene.epsilon : C.epsilon;
    const rmin = C.rmin || eps;
    const maxSteps = C.maxSteps;

    let onNeumann = false;
    let inwardN = [0, 0];

    for (let s = 0; s < maxSteps; s++) {
      const dD = distToDirichlet(x, y, scene);
      if (dD.dist < eps) {
        return { steps: s, endX: x, endY: y, kind: 'D', value: dD.value, points, radii };
      }

      const dSil = silhouetteDist(x, y, scene);
      const r = Math.max(rmin, Math.min(dD.dist, dSil));

      // Sample direction. If sitting on a Neumann surface, restrict to the
      // hemisphere pointing into the domain.
      let vx, vy;
      if (onNeumann) {
        const phi = Math.atan2(inwardN[1], inwardN[0]);
        const a = phi + (Math.random() - 0.5) * Math.PI;
        vx = Math.cos(a); vy = Math.sin(a);
      } else {
        const a = Math.random() * Math.PI * 2;
        vx = Math.cos(a); vy = Math.sin(a);
      }

      const hit = rayHitNeumann(x, y, vx, vy, r, scene);
      if (hit.t < r) {
        // Land on Neumann surface. rayHitNeumann returns the outward normal
        // of the obstacle, which points into the domain Ω — that's exactly
        // the hemisphere axis we want for the next direction sample.
        x += vx * hit.t;
        y += vy * hit.t;
        inwardN = [hit.normal[0], hit.normal[1]];
        // Tiny nudge into Ω to keep us off the surface numerically.
        x += inwardN[0] * eps * 0.25;
        y += inwardN[1] * eps * 0.25;
        onNeumann = true;
      } else {
        x += vx * r;
        y += vy * r;
        onNeumann = false;
      }
      if (points) points.push([x, y]);
      if (radii) radii.push(r);
    }
    return { steps: maxSteps, endX: x, endY: y, kind: 'X', value: 0, points, radii };
  }

  function walkWoS(scene, sx, sy, recordPath) {
    let x = sx, y = sy;
    const points = recordPath ? [[x, y]] : null;
    // See walkWoSt: one radius per point transition. In WoS the step region
    // is a full ball (no Neumann occluders within r), so the rendered star
    // collapses to a plain circle.
    const radii = recordPath ? [] : null;
    const eps = (scene && scene.epsilon != null) ? scene.epsilon : C.epsilon;
    const maxSteps = C.maxSteps;

    for (let s = 0; s < maxSteps; s++) {
      const info = distToSegments(x, y, scene);

      if (info.dist < eps && (info.kind === 'D' || info.kind === 'I')) {
        return { steps: s, endX: x, endY: y, kind: info.kind, value: info.value, points, radii };
      }
      if (info.dist < eps && info.kind === 'N') {
        x += info.normal[0] * eps * 1.5;
        y += info.normal[1] * eps * 1.5;
        if (points) points.push([x, y]);
        if (radii) radii.push(info.dist); // tiny nudge — negligible sphere
        continue;
      }

      const r = Math.max(info.dist, eps);
      const dir = U.randSphere();
      x += dir[0] * r;
      y += dir[1] * r;
      if (points) points.push([x, y]);
      if (radii) radii.push(r);
    }
    return { steps: maxSteps, endX: x, endY: y, kind: 'X', value: 0, points, radii };
  }

  function walk(scene, sx, sy, recordPath) {
    return (scene.mode === 'wos' ? walkWoS : walkWoSt)(scene, sx, sy, recordPath);
  }

  function estimate(scene, x, y, n) {
    let sum = 0, hits = 0;
    for (let i = 0; i < n; i++) {
      const r = walk(scene, x, y, false);
      if (r.kind === 'D' || r.kind === 'I') { sum += r.value; hits++; }
    }
    return hits > 0 ? sum / hits : 0;
  }

  function unitSquareScene(wallVals, rects) {
    return {
      walls: [
        { x0:0, y0:1, x1:1, y1:1, kind:'D', value:wallVals[0] },
        { x0:1, y0:0, x1:1, y1:1, kind:'D', value:wallVals[1] },
        { x0:0, y0:0, x1:1, y1:0, kind:'D', value:wallVals[2] },
        { x0:0, y0:0, x1:0, y1:1, kind:'D', value:wallVals[3] },
      ],
      rects: rects || [],
    };
  }

  W.WoDS.solver = {
    walk, estimate, distToSegments, distToDirichlet, silhouetteDist,
    rayHitNeumann, unitSquareScene
  };
})(window);
