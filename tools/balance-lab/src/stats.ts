/** Small statistics helpers for the lab scripts (no dependencies). */

export const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export const sd = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};

export function pearson(pairs: readonly (readonly [number, number])[]): number {
  const ma = mean(pairs.map((p) => p[0]));
  const mb = mean(pairs.map((p) => p[1]));
  let [sab, saa, sbb] = [0, 0, 0];
  for (const [a, b] of pairs) {
    sab += (a - ma) * (b - mb);
    saa += (a - ma) ** 2;
    sbb += (b - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

/**
 * Linear least squares with an intercept: `y ≈ c[0] + Σ c[i+1]·x[i]`. `ridge` > 0 shrinks the
 * slopes (not the intercept); 0 is plain least squares. Returns the coefficients, intercept first.
 */
export function fitLinear(x: readonly number[][], y: readonly number[], ridge = 0): number[] {
  const rows = x.map((r) => [1, ...r]);
  const k = rows[0]!.length;
  const a = Array.from({ length: k }, (_, i) => [
    ...Array.from(
      { length: k },
      (_, j) => rows.reduce((s, r) => s + r[i]! * r[j]!, 0) + (i === j && i > 0 ? ridge : 0),
    ),
    rows.reduce((s, r, n) => s + r[i]! * y[n]!, 0),
  ]);
  // Gauss-Jordan with partial pivoting.
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    [a[c], a[p]] = [a[p]!, a[c]!];
    const d = a[c]![c]!;
    a[c] = a[c]!.map((v) => v / d);
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      a[r] = a[r]!.map((v, j) => v - f * a[c]![j]!);
    }
  }
  return a.map((r) => r[k]!);
}
