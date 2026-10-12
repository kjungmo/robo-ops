/**
 * Small statistics helpers shared by scripts/paper-data.ts and
 * scripts/check-paper.ts: Student-t distribution and Holm's step-down
 * procedure. No dependency; accuracy is checked in check-paper.ts against
 * tabulated quantiles.
 */

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155, 0.001208650973866179, -0.5395239384953e-5]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (const cj of c) {
    y += 1
    ser += cj / y
  }
  return -tmp + Math.log((2.5066282746310002 * ser) / x)
}

/** Regularised incomplete beta function I_x(a, b) (continued fraction, Lentz). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  const cf = (xx: number, aa: number, bb: number): number => {
    const tiny = 1e-300
    let c = 1
    let d = 1 - ((aa + bb) * xx) / (aa + 1)
    if (Math.abs(d) < tiny) d = tiny
    d = 1 / d
    let h = d
    for (let m = 1; m <= 300; m += 1) {
      const m2 = 2 * m
      let num = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2))
      d = 1 + num * d
      if (Math.abs(d) < tiny) d = tiny
      c = 1 + num / c
      if (Math.abs(c) < tiny) c = tiny
      d = 1 / d
      h *= d * c
      num = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1))
      d = 1 + num * d
      if (Math.abs(d) < tiny) d = tiny
      c = 1 + num / c
      if (Math.abs(c) < tiny) c = tiny
      d = 1 / d
      const del = d * c
      h *= del
      if (Math.abs(del - 1) < 1e-14) break
    }
    return h
  }
  if (x < (a + 1) / (a + b + 2)) return (front * cf(x, a, b)) / a
  return 1 - (front * cf(1 - x, b, a)) / b
}

/** Two-sided p-value of a Student-t statistic with `df` degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  return incompleteBeta(df / (df + t * t), df / 2, 0.5)
}

/** Two-sided quantile: the t with tTwoSidedP(t, df) = alpha (bisection). */
export function tQuantileTwoSided(alpha: number, df: number): number {
  let lo = 0
  let hi = 1000
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    if (tTwoSidedP(mid, df) > alpha) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Holm's step-down procedure at family-wise level alpha. Returns, for each
 * p-value, whether its hypothesis is rejected.
 */
export function holm(p: number[], alpha = 0.05): boolean[] {
  const order = p.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<boolean>(p.length).fill(false)
  for (let k = 0; k < order.length; k += 1) {
    if (order[k].v > alpha / (order.length - k)) break
    out[order[k].i] = true
  }
  return out
}
