/* ==============================================================
 * High-resolution video export for the interactive figures.
 *
 * AUTHORING TOOL — not shipped to readers. Activates ONLY when the
 * page is loaded with ?record=1 in the URL, e.g.
 *
 *     index.html?record=1            (default 4x backing store, 60fps)
 *     index.html?record=1&scale=6    (6x — denser, slower to encode)
 *
 * It drops a small "Rec" button on every diagram canvas. Clicking it:
 *   1. Re-fits that canvas at WoDS.captureScale (default 4x) so the
 *      backing store is, say, 1520x1520 for a 380px figure. The CSS
 *      (on-screen) size is unchanged; only the pixels grow.
 *   2. Composites each frame onto an opaque WHITE stage canvas (the
 *      figures clear to transparent) and records that stream into a
 *      MediaRecorder at a high bitrate, saving a .webm named after
 *      the <figure> id. The white background means the clip drops
 *      cleanly onto a slide with no alpha/black fringing.
 *   3. On stop, restores the canvas to normal resolution.
 *
 * captureStream records the backing-store resolution, so the boosted
 * scale yields a genuinely high-res clip independent of your monitor.
 * These are lightweight 2D canvases, so real-time capture at 4x is
 * fine; if a figure stutters, lower &scale or close other tabs.
 *
 * Output format: MediaRecorder cannot emit ProRes. In Safari (16.4+)
 * this records MP4/H.264 directly (no post-step). Elsewhere it records
 * WebM. Either way, batch-convert to presentation video with:
 *     tools/convert.sh ~/Downloads prores      # ProRes .mov for Keynote
 *     tools/convert.sh ~/Downloads mp4          # H.264 .mp4
 * Force WebM with ?format=webm if you always want to convert downstream.
 *
 * For perfectly smooth, reproducible, arbitrary-resolution clips of
 * the marquee figures, the "Tier 2" path is deterministic offline
 * frame rendering (seeded RNG + injected clock + toBlob per frame).
 * That needs per-figure refactoring and is intentionally not here.
 * ============================================================== */
(function (W) {
  const params = new URLSearchParams(W.location.search);
  if (params.get('record') !== '1') return;

  const U = W.WoDS.util;
  const SCALE = parseFloat(params.get('scale')) || 4;
  const FPS = parseInt(params.get('fps')) || 60;
  const BITRATE = (parseInt(params.get('mbps')) || 80) * 1e6;

  // Prefer MP4/H.264 when the browser can record it (Safari 16.4+), so
  // the download needs no post-processing. Everyone else gets WebM, which
  // convert.sh turns into ProRes/MP4. Force WebM with ?format=webm.
  function pickMime() {
    const wantWebm = params.get('format') === 'webm';
    const cands = wantWebm ? [] : [
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];
    cands.push('video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm');
    return cands.find((c) => W.MediaRecorder &&
      MediaRecorder.isTypeSupported(c)) || 'video/webm';
  }

  function extFor(mime) {
    return mime.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
  }

  function figureName(canvas) {
    const fig = canvas.closest('figure');
    if (fig && fig.id) return fig.id;
    const all = [...document.querySelectorAll('canvas.diagram')];
    return 'figure-' + (all.indexOf(canvas) + 1);
  }

  // Re-fit the canvas at the boosted scale; return a restore fn.
  function boost(canvas) {
    const w = parseFloat(canvas.style.width);
    const h = parseFloat(canvas.style.height);
    const prev = W.WoDS.captureScale;
    W.WoDS.captureScale = SCALE;
    U.fitCanvas(canvas, w, h);
    return function restore() {
      W.WoDS.captureScale = prev;
      U.fitCanvas(canvas, w, h); // back to devicePixelRatio
    };
  }

  function startRecording(canvas, btn) {
    const restore = boost(canvas);
    const mime = pickMime();

    // The figure canvases clear to transparent (clearRect), so capturing
    // them directly yields a video with an alpha channel that reads as
    // black on a slide. Instead, composite each frame onto an opaque
    // white stage canvas and record THAT. Sized to the boosted backing
    // store so the copy is pixel-for-pixel (no rescale).
    const stage = document.createElement('canvas');
    stage.width = canvas.width;
    stage.height = canvas.height;
    const sctx = stage.getContext('2d', { alpha: false });
    let copyRaf = null;
    function copyFrame() {
      sctx.fillStyle = '#ffffff';
      sctx.fillRect(0, 0, stage.width, stage.height);
      sctx.drawImage(canvas, 0, 0);
      copyRaf = W.requestAnimationFrame(copyFrame);
    }
    copyFrame();

    const stream = stage.captureStream(FPS);
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: BITRATE,
    });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      if (copyRaf) W.cancelAnimationFrame(copyRaf);
      restore();
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = figureName(canvas) + '.' + extFor(mime);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      btn.textContent = '⏺ Rec';
      btn.style.background = '#b8362a';
      btn._rec = null;
    };
    rec.start();
    btn._rec = rec;
    btn.textContent = '⏹ Stop';
    btn.style.background = '#1a1a1a';
  }

  function attach(canvas) {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '⏺ Rec';
    btn.title = 'Record this figure to .webm (' + SCALE + 'x, ' + FPS + 'fps)';
    btn.style.cssText = [
      'position:absolute', 'top:6px', 'right:6px', 'z-index:50',
      'font:600 12px monospace', 'padding:3px 8px', 'color:#fff',
      'background:#b8362a', 'border:none', 'border-radius:4px',
      'cursor:pointer', 'opacity:.9',
    ].join(';');
    btn.addEventListener('click', () => {
      if (btn._rec) btn._rec.stop();
      else startRecording(canvas, btn);
    });
    wrap.appendChild(btn);
  }

  W.addEventListener('load', () => {
    // Let figure init() run first so canvases are sized.
    setTimeout(() => {
      document.querySelectorAll('canvas.diagram').forEach(attach);
      console.info('[capture] record mode on — scale=' + SCALE +
        ', fps=' + FPS + ', mime=' + pickMime());
    }, 400);
  });
})(window);
