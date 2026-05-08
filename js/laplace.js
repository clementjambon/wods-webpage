/* Tiny grid-based Laplace solver for in-browser ground truth.
 *
 * Solves ∇²u = 0 with mixed Dirichlet/Neumann on a uniform N×N grid
 * of the unit square. The discretization is the standard 5-point
 * Laplacian; we assemble the resulting linear system A x = b in
 * banded form (bandwidth = N) and factor it with a direct banded LU
 * (no pivoting — A is weakly diagonally dominant).
 *
 * Cell tags: 'F' free, 'D' Dirichlet (fixed value), 'N' Neumann
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

  // `iters` accepted for backwards compatibility with the old Jacobi
  // signature but ignored — this is a direct solve.
  function solve(g, _iters) {
    const N = g.N, n = N*N, b = N, Wb = 2*b + 1;
    const u = g.u, tag = g.tag;
    const ab = new Float64Array(n * Wb); // ab[i*Wb + (j-i+b)] = A[i][j]
    const rhs = new Float64Array(n);

    // Assemble the banded matrix and RHS with the same per-cell rules
    // the old Jacobi solver implemented at its fixed point:
    //   D : u_k = value
    //   N : boundary band → u_k - u_inward = 0
    //       interior      → c·u_k - Σ u_{non-N neighbours} = 0
    //   F : interior → 4·u_k - Σ u_{neighbour} = 0
    //       boundary → c·u_k - Σ u_{neighbour} = 0
    // Dirichlet neighbour values are eliminated to the RHS.
    for (let k = 0; k < n; k++) {
      const i = k % N, jj = (k - i) / N;
      const row = k * Wb;
      if (tag[k] === D) { ab[row + b] = 1; rhs[k] = u[k]; continue; }

      const nbrs = [];
      if (i > 0)   nbrs.push(k - 1);
      if (i < N-1) nbrs.push(k + 1);
      if (jj > 0)  nbrs.push(k - N);
      if (jj < N-1)nbrs.push(k + N);

      if (tag[k] === N_) {
        const onBnd = (i === 0 || i === N-1 || jj === 0 || jj === N-1);
        if (onBnd) {
          let nb;
          if      (jj === 0)   nb = k + N;
          else if (jj === N-1) nb = k - N;
          else if (i === 0)    nb = k + 1;
          else                 nb = k - 1;
          ab[row + b] = 1;
          ab[row + (nb - k + b)] = -1;
        } else {
          let nonN = 0, bk = 0;
          const off = [];
          for (const kk of nbrs) {
            if (tag[kk] === N_) continue;
            nonN++;
            if (tag[kk] === D) bk += u[kk];
            else off.push(kk);
          }
          if (nonN === 0) { ab[row + b] = 1; rhs[k] = u[k]; }
          else {
            ab[row + b] = nonN;
            for (const kk of off) ab[row + (kk - k + b)] = -1;
            rhs[k] = bk;
          }
        }
        continue;
      }

      // Free cell
      const interior = (i > 0 && i < N-1 && jj > 0 && jj < N-1);
      ab[row + b] = interior ? 4 : nbrs.length;
      let bk = 0;
      for (const kk of nbrs) {
        if (tag[kk] === D) bk += u[kk];
        else ab[row + (kk - k + b)] = -1;
      }
      rhs[k] = bk;
    }

    // Banded LU in place. L (unit diag) stored below diag, U on/above.
    for (let k = 0; k < n; k++) {
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

  W.WoDS.laplace = { makeGrid, solve, F, D, N: N_ };
})(window);
