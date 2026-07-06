/* Tiny grid-based Laplace solver for in-browser ground truth.
 *
 * Solves ∇²u = 0 with mixed Dirichlet/Neumann on a uniform N×N grid
 * of the unit square. The discretization is the standard 5-point
 * Laplacian; we assemble the resulting linear system A x = b in
 * banded form (bandwidth = N) and factor it with a direct banded LU
 * (no pivoting — A is weakly diagonally dominant).
 *
 * The matrix A depends ONLY on the tag layout (which cells are
 * Dirichlet/Neumann/free) — painting boundary values or applying a
 * preset changes just the right-hand side. So factorizations are
 * cached keyed on the exact tag bytes: the first solve for a tag
 * layout pays the full LU (O(N⁴) — tens to hundreds of ms), every
 * later solve is a banded substitution (O(N³) — a millisecond). The
 * preset thumbnails share the main grid's tags, so a whole figure
 * needs exactly one factorization per scene. WebKit in particular is
 * ~10x slower than Blink on the LU inner loop, which made the old
 * factor-per-call behavior unusable for painting in Safari.
 *
 * warmFactor(g, rows) lets figures precompute the LU in bounded slices
 * (from their deferred-work queues) so the one-time cost never lands
 * as a single long task either.
 *
 * Cell tags: 0=F free, 1=D Dirichlet (fixed value), 2=N Neumann
 * (zero-flux, implemented as mirror-the-inward-neighbour identity).
 */
(function (W) {
  function makeGrid(N) {
    return {
      N,
      u: new Float32Array(N*N),
      tag: new Uint8Array(N*N), // 0=F, 1=D, 2=N
    };
  }
  const F = 0, D = 1, N_ = 2;

  // ---- factorization cache -----------------------------------------
  const CACHE_MAX = 3; // LU is ~3-8MB per entry; typical pages use 1-2
  const cache = [];    // [{N, tags(copy), ab(factored)}], most recent first
  let pending = null;  // in-progress chunked factorization

  function tagsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function findCached(g) {
    for (let c = 0; c < cache.length; c++) {
      const e = cache[c];
      if (e.N === g.N && tagsEqual(e.tags, g.tag)) {
        if (c > 0) { cache.splice(c, 1); cache.unshift(e); }
        return e;
      }
    }
    return null;
  }

  // Assemble the banded matrix for g's tags. Same per-cell rules the
  // original Jacobi solver implemented at its fixed point:
  //   D : u_k = value
  //   N : boundary band → u_k - u_inward = 0
  //       interior      → c·u_k - Σ u_{non-N neighbours} = 0
  //   F : interior → 4·u_k - Σ u_{neighbour} = 0
  //       boundary → c·u_k - Σ u_{neighbour} = 0
  // Dirichlet neighbour values are eliminated to the RHS (see
  // assembleRhs, which must mirror this classification exactly).
  function assembleMatrix(g) {
    const N = g.N, n = N*N, b = N, Wb = 2*b + 1;
    const tag = g.tag;
    const ab = new Float64Array(n * Wb); // ab[i*Wb + (j-i+b)] = A[i][j]
    for (let k = 0; k < n; k++) {
      const i = k % N, jj = (k - i) / N;
      const row = k * Wb;
      if (tag[k] === D) { ab[row + b] = 1; continue; }

      const hasL = i > 0, hasR = i < N-1, hasB = jj > 0, hasT = jj < N-1;

      if (tag[k] === N_) {
        const onBnd = !(hasL && hasR && hasB && hasT);
        if (onBnd) {
          let nb;
          if      (!hasB) nb = k + N;
          else if (!hasT) nb = k - N;
          else if (!hasL) nb = k + 1;
          else            nb = k - 1;
          ab[row + b] = 1;
          ab[row + (nb - k + b)] = -1;
        } else {
          let nonN = 0;
          if (tag[k-1] !== N_) { nonN++; if (tag[k-1] !== D) ab[row + (-1 + b)] = -1; }
          if (tag[k+1] !== N_) { nonN++; if (tag[k+1] !== D) ab[row + ( 1 + b)] = -1; }
          if (tag[k-N] !== N_) { nonN++; if (tag[k-N] !== D) ab[row + (-N + b)] = -1; }
          if (tag[k+N] !== N_) { nonN++; if (tag[k+N] !== D) ab[row + ( N + b)] = -1; }
          if (nonN === 0) {
            // isolated inside Neumann geometry: keep current value
            for (let o = 0; o < Wb; o++) ab[row + o] = 0;
            ab[row + b] = 1;
          } else {
            ab[row + b] = nonN;
          }
        }
        continue;
      }

      // Free cell
      let deg = 0;
      if (hasL) { deg++; if (tag[k-1] !== D) ab[row + (-1 + b)] = -1; }
      if (hasR) { deg++; if (tag[k+1] !== D) ab[row + ( 1 + b)] = -1; }
      if (hasB) { deg++; if (tag[k-N] !== D) ab[row + (-N + b)] = -1; }
      if (hasT) { deg++; if (tag[k+N] !== D) ab[row + ( N + b)] = -1; }
      const interior = hasL && hasR && hasB && hasT;
      ab[row + b] = interior ? 4 : deg;
    }
    return ab;
  }

  // Right-hand side for g's current values under the same rules.
  function assembleRhs(g, rhs) {
    const N = g.N, n = N*N;
    const u = g.u, tag = g.tag;
    for (let k = 0; k < n; k++) {
      const i = k % N, jj = (k - i) / N;
      if (tag[k] === D) { rhs[k] = u[k]; continue; }
      const hasL = i > 0, hasR = i < N-1, hasB = jj > 0, hasT = jj < N-1;

      if (tag[k] === N_) {
        const onBnd = !(hasL && hasR && hasB && hasT);
        if (onBnd) { rhs[k] = 0; continue; }
        let nonN = 0, bk = 0;
        if (tag[k-1] !== N_) { nonN++; if (tag[k-1] === D) bk += u[k-1]; }
        if (tag[k+1] !== N_) { nonN++; if (tag[k+1] === D) bk += u[k+1]; }
        if (tag[k-N] !== N_) { nonN++; if (tag[k-N] === D) bk += u[k-N]; }
        if (tag[k+N] !== N_) { nonN++; if (tag[k+N] === D) bk += u[k+N]; }
        rhs[k] = nonN === 0 ? u[k] : bk;
        continue;
      }

      let bk = 0;
      if (hasL && tag[k-1] === D) bk += u[k-1];
      if (hasR && tag[k+1] === D) bk += u[k+1];
      if (hasB && tag[k-N] === D) bk += u[k-N];
      if (hasT && tag[k+N] === D) bk += u[k+N];
      rhs[k] = bk;
    }
  }

  // Banded LU elimination of rows k0..k0+rows-1 (in place, resumable).
  // L (unit diag) stored below the diagonal, U on/above.
  function eliminateRows(ab, n, b, Wb, k0, rows) {
    const kEnd = Math.min(n, k0 + rows);
    for (let k = k0; k < kEnd; k++) {
      const akk = ab[k*Wb + b];
      const iMax = Math.min(n - 1, k + b);
      const kRowOff = k*Wb - k + b; // ab[kRowOff + j] = A[k][j]
      for (let ii = k + 1; ii <= iMax; ii++) {
        const iiRowOff = ii*Wb - ii + b;
        const aik = ab[iiRowOff + k];
        if (aik === 0) continue;
        const f = aik / akk;
        ab[iiRowOff + k] = f;
        for (let j = k + 1; j <= iMax; j++) {
          ab[iiRowOff + j] -= f * ab[kRowOff + j];
        }
      }
    }
    return kEnd;
  }

  function insertCache(entry) {
    cache.unshift(entry);
    if (cache.length > CACHE_MAX) cache.pop();
  }

  // Advance (or start) the factorization for g's current tags by
  // `rows` elimination rows. Returns true once a factorization is
  // ready — after that, solve(g) is a cheap substitution. Figures call
  // this from their deferred-work queues so the one-time LU cost never
  // blocks a frame for long, even in slower engines.
  function warmFactor(g, rows) {
    if (findCached(g)) { pendingDropIfStale(g); return true; }
    if (!pending || pending.N !== g.N || !tagsEqual(pending.tags, g.tag)) {
      pending = {
        N: g.N,
        tags: g.tag.slice(),
        ab: assembleMatrix(g),
        k: 0,
      };
    }
    const N = pending.N, n = N*N, b = N, Wb = 2*b + 1;
    pending.k = eliminateRows(pending.ab, n, b, Wb, pending.k, rows || n);
    if (pending.k >= n) {
      insertCache({ N: pending.N, tags: pending.tags, ab: pending.ab });
      pending = null;
      return true;
    }
    return false;
  }

  function pendingDropIfStale(g) {
    // A cached factorization appeared for the tags we were warming
    // (e.g. a sync solve finished first) — drop the duplicate work.
    if (pending && pending.N === g.N && tagsEqual(pending.tags, g.tag)) pending = null;
  }

  // Reused RHS scratch, per grid size.
  const scratch = {};
  function rhsFor(n) {
    return scratch[n] || (scratch[n] = new Float64Array(n));
  }

  // `iters` accepted for backwards compatibility with the old Jacobi
  // signature but ignored — this is a direct (exact) solve.
  function solve(g, _iters) {
    let e = findCached(g);
    if (!e) {
      warmFactor(g, g.N * g.N); // factor to completion synchronously
      e = findCached(g);
    }
    const N = g.N, n = N*N, b = N, Wb = 2*b + 1;
    const ab = e.ab;
    const rhs = rhsFor(n);
    assembleRhs(g, rhs);

    // Forward solve L y = rhs
    for (let i = 0; i < n; i++) {
      const iMin = Math.max(0, i - b);
      const off = i*Wb - i + b;
      let s = rhs[i];
      for (let j = iMin; j < i; j++) s -= ab[off + j] * rhs[j];
      rhs[i] = s;
    }
    // Back solve U x = y
    for (let i = n - 1; i >= 0; i--) {
      const jMax = Math.min(n - 1, i + b);
      const off = i*Wb - i + b;
      let s = rhs[i];
      for (let j = i + 1; j <= jMax; j++) s -= ab[off + j] * rhs[j];
      rhs[i] = s / ab[i*Wb + b];
    }
    for (let k = 0; k < n; k++) g.u[k] = rhs[k];
  }

  W.WoDS.laplace = { makeGrid, solve, warmFactor, F, D, N: N_ };
})(window);
