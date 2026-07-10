/* Studio-only — a canvas-2D-shaped object that records SVG instead of pixels.
 *
 * AUTHORING TOOL, not shipped to readers. It implements exactly the slice of
 * CanvasRenderingContext2D that the still-frame figures draw with:
 *
 *   save/restore · clearRect · fillRect · strokeRect · setLineDash
 *   beginPath · moveTo · lineTo · closePath · arc · fill · stroke
 *   fillStyle · strokeStyle · lineWidth · globalAlpha · lineJoin · lineCap
 *
 * A figure exports vector by pointing its `ctx` at one of these and calling
 * its ordinary render() — no second drawing path to keep in sync. Anything
 * outside the list above is deliberately absent: a figure that grows a
 * gradient, a clip, or drawImage will throw here rather than silently drop
 * it from the SVG.
 *
 * Two things keep the output small enough to open in a vector editor:
 *   - a beginPath/arc/fill/stroke that traces one full circle emits <circle>,
 *     not a 2-command <path>;
 *   - a stroke() immediately after a fill() on the same path emits ONE element
 *     carrying both paints, rather than two overlapping copies of the geometry.
 *
 * Canvas alpha has two sources — globalAlpha and the color's own alpha (the
 * theme's Neumann fill is an rgba()). SVG has no globalAlpha, so both are
 * folded into fill-opacity / stroke-opacity per element.
 */
(function (W) {
  'use strict';

  const STYLE_KEYS = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha',
    'lineJoin', 'lineCap'];

  // Two decimals is ~0.005px at export scale — far below a hairline, and it
  // roughly halves the file next to full float precision.
  function num(v) {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? 0 : r;
  }

  // 'rgba(0,0,0,0.08)' → { color: 'rgb(0,0,0)', alpha: 0.08 }. SVG 1.1 paints
  // don't take an alpha channel, so it has to move to *-opacity.
  function splitColor(c) {
    if (typeof c !== 'string') return { color: '#000000', alpha: 1 };
    const m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (!m) return { color: c.trim(), alpha: 1 };
    const p = m[1].split(',').map((s) => parseFloat(s));
    const a = p.length > 3 && isFinite(p[3]) ? p[3] : 1;
    return { color: `rgb(${p[0] | 0},${p[1] | 0},${p[2] | 0})`, alpha: a };
  }

  function attrsToString(a) {
    return Object.keys(a)
      .filter((k) => a[k] !== null && a[k] !== undefined)
      .map((k) => `${k}="${a[k]}"`)
      .join(' ');
  }

  function create(width, height) {
    const els = [];          // { tag, attrs, pathId, painted }
    const stack = [];
    let dash = null;

    // Bumped by every path-mutating call, so fill/stroke merging can tell
    // "same geometry" from "new geometry that happens to follow".
    let pathId = 0;
    let d = '';
    let circle = null;       // set iff the path is exactly one full arc
    let pathEmpty = true;

    const ctx = {
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      globalAlpha: 1,
      lineJoin: 'miter',
      lineCap: 'butt',
    };

    function fillPaint(a) {
      const { color, alpha } = splitColor(ctx.fillStyle);
      const o = alpha * ctx.globalAlpha;
      a.fill = color;
      if (o < 1) a['fill-opacity'] = num(o);
    }

    function strokePaint(a) {
      const { color, alpha } = splitColor(ctx.strokeStyle);
      const o = alpha * ctx.globalAlpha;
      a.stroke = color;
      a['stroke-width'] = num(ctx.lineWidth);
      if (o < 1) a['stroke-opacity'] = num(o);
      if (ctx.lineJoin !== 'miter') a['stroke-linejoin'] = ctx.lineJoin;
      if (ctx.lineCap !== 'butt') a['stroke-linecap'] = ctx.lineCap;
      if (dash) a['stroke-dasharray'] = dash.map(num).join(' ');
    }

    function push(tag, attrs, painted) {
      const el = { tag, attrs, pathId, painted };
      els.push(el);
      return el;
    }

    // The element a stroke() can merge into: the immediately preceding one,
    // if it was a fill of this same path and nothing has been drawn since.
    function mergeTarget() {
      const last = els[els.length - 1];
      return last && last.pathId === pathId && last.painted === 'fill' ? last : null;
    }

    function pathAttrs() {
      return circle
        ? { tag: 'circle', attrs: { cx: num(circle.cx), cy: num(circle.cy), r: num(circle.r) } }
        : { tag: 'path', attrs: { d: d } };
    }

    ctx.save = function () {
      const s = { dash: dash };
      for (const k of STYLE_KEYS) s[k] = ctx[k];
      stack.push(s);
    };

    ctx.restore = function () {
      const s = stack.pop();
      if (!s) return;
      for (const k of STYLE_KEYS) ctx[k] = s[k];
      dash = s.dash;
    };

    ctx.setLineDash = function (arr) {
      dash = arr && arr.length ? arr.slice() : null;
    };

    // The SVG starts empty; there is nothing to clear.
    ctx.clearRect = function () {};

    ctx.fillRect = function (x, y, w, h) {
      const a = { x: num(x), y: num(y), width: num(w), height: num(h) };
      fillPaint(a);
      pathId++;
      push('rect', a, 'fill');
    };

    ctx.strokeRect = function (x, y, w, h) {
      const a = { x: num(x), y: num(y), width: num(w), height: num(h), fill: 'none' };
      strokePaint(a);
      pathId++;
      push('rect', a, 'stroke');
    };

    ctx.beginPath = function () {
      pathId++;
      d = '';
      circle = null;
      pathEmpty = true;
    };

    ctx.moveTo = function (x, y) {
      pathId++;
      d += `M${num(x)} ${num(y)}`;
      circle = null;
      pathEmpty = false;
    };

    ctx.lineTo = function (x, y) {
      pathId++;
      d += `L${num(x)} ${num(y)}`;
      circle = null;
      pathEmpty = false;
    };

    ctx.closePath = function () {
      pathId++;
      d += 'Z';
    };

    // Only the full-circle form the figures use. A partial arc would need the
    // endpoint/sweep math, so refuse rather than emit a wrong shape.
    ctx.arc = function (cx, cy, r, a0, a1) {
      if (Math.abs(Math.abs(a1 - a0) - Math.PI * 2) > 1e-6) {
        throw new Error('svgRecorder.arc: only full circles are supported');
      }
      pathId++;
      circle = pathEmpty ? { cx: cx, cy: cy, r: r } : null;
      pathEmpty = false;
      // Two half-arcs; SVG's elliptical arc can't sweep 360° in one command.
      d += `M${num(cx - r)} ${num(cy)}` +
        `A${num(r)} ${num(r)} 0 1 0 ${num(cx + r)} ${num(cy)}` +
        `A${num(r)} ${num(r)} 0 1 0 ${num(cx - r)} ${num(cy)}Z`;
    };

    ctx.fill = function () {
      if (pathEmpty) return;
      const { tag, attrs } = pathAttrs();
      fillPaint(attrs);
      push(tag, attrs, 'fill');
    };

    ctx.stroke = function () {
      if (pathEmpty) return;
      const target = mergeTarget();
      if (target) {
        strokePaint(target.attrs);
        target.painted = 'both';
        return;
      }
      const { tag, attrs } = pathAttrs();
      attrs.fill = 'none';
      strokePaint(attrs);
      push(tag, attrs, 'stroke');
    };

    function toSVG() {
      const body = els
        .map((e) => `  <${e.tag} ${attrsToString(e.attrs)}/>`)
        .join('\n');
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${body}
</svg>
`;
    }

    return { ctx: ctx, toSVG: toSVG, count: () => els.length };
  }

  W.WoDS.svgRecorder = create;
})(window);
