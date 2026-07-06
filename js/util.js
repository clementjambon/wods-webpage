/* Shared utilities: hi-DPI canvas, color math, geometry. */
(function (W) {
  const U = {};

  // Set up a hi-DPI canvas with a logical width/height in CSS pixels.
  // W.WoDS.captureScale, when set, overrides devicePixelRatio so the
  // capture helper (js/capture.js) can render the backing store at an
  // arbitrarily high resolution for video export without changing the
  // on-screen (CSS) size. Normal page loads never set it.
  U.fitCanvas = function (canvas, w, h) {
    const dpr = W.WoDS.captureScale || window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

  // Linearly interpolate two hex colors at t in [0,1].
  function hexToRgb(h) {
    h = h.replace('#','');
    if (h.length === 3) h = h.split('').map(c=>c+c).join('');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function lerp(a,b,t){return a+(b-a)*t;}
  U.lerpColor = function (a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return `rgb(${Math.round(lerp(A[0],B[0],t))},${Math.round(lerp(A[1],B[1],t))},${Math.round(lerp(A[2],B[2],t))})`;
  };
  U.hexToRgb = hexToRgb;

  // Diverging colormap: t in [0,1], using theme stops.
  U.colormap = function (t, theme) {
    t = Math.max(0, Math.min(1, t));
    if (t < 0.5) return U.lerpColor(theme.hmLow, theme.hmMid, t * 2);
    return U.lerpColor(theme.hmMid, theme.hmHigh, (t - 0.5) * 2);
  };

  // RNG
  U.rand = Math.random;
  U.randSphere = function () {
    const a = Math.random() * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };

  // Distance from point to axis-aligned rectangle (signed: negative inside).
  // Used as the unsigned distance to the rect's boundary.
  U.distToRect = function (px, py, x0, y0, x1, y1) {
    // Distance to boundary of axis-aligned rect (point can be inside or outside).
    const dx = Math.max(x0 - px, 0, px - x1);
    const dy = Math.max(y0 - py, 0, py - y1);
    if (dx === 0 && dy === 0) {
      // Inside: distance to nearest edge
      return Math.min(px - x0, x1 - px, py - y0, y1 - py);
    }
    return Math.sqrt(dx*dx + dy*dy);
  };

  // Closest point on rect boundary
  U.closestOnRect = function (px, py, x0, y0, x1, y1) {
    // If inside, project to nearest edge
    const inside = (px > x0 && px < x1 && py > y0 && py < y1);
    if (inside) {
      const dL = px - x0, dR = x1 - px, dB = py - y0, dT = y1 - py;
      const m = Math.min(dL, dR, dB, dT);
      if (m === dL) return [x0, py];
      if (m === dR) return [x1, py];
      if (m === dB) return [px, y0];
      return [px, y1];
    }
    return [Math.max(x0, Math.min(px, x1)), Math.max(y0, Math.min(py, y1))];
  };

  // Visibility-gated animation loop. Drives tick(t) from
  // requestAnimationFrame only while `el` is on screen (plus a small
  // margin), so off-screen figures cost nothing. The timestamp passed
  // to tick is a virtual clock that freezes while the loop is paused:
  // time-based state (hold timers, per-step clocks, dt easing) resumes
  // where it left off instead of seeing one huge dt after a long scroll.
  // Returns a handle whose .visible flag lets non-rAF work (background
  // setTimeout chains) gate itself on the same observer.
  U.animLoop = function (el, tick) {
    const handle = { visible: true };
    let raf = null, last = 0, gap = false, offset = 0;
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (gap) { offset += t - last; gap = false; }
      last = t;
      tick(t - offset);
    }
    if (!W.IntersectionObserver) { // very old browser: run unconditionally
      raf = requestAnimationFrame(frame);
      return handle;
    }
    const io = new IntersectionObserver((entries) => {
      // A single callback can batch several transitions (fast scroll
      // past a short figure delivers enter+exit together) — only the
      // LAST entry reflects the current state.
      const on = entries[entries.length - 1].isIntersecting;
      handle.visible = on;
      if (on && raf === null) {
        gap = last > 0; // freeze the virtual clock across the pause
        raf = requestAnimationFrame(frame);
      } else if (!on && raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }, { rootMargin: '96px 0px' });
    io.observe(el);
    return handle;
  };

  W.WoDS.util = U;
})(window);
