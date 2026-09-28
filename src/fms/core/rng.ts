/**
 * Deterministic pseudo-random number generator (mulberry32).
 *
 * Every stochastic decision in the fleet simulator (task arrivals, endpoint
 * sampling, initial battery levels) is drawn from one instance so that a run
 * is fully reproducible from its seed.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next()
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array')
    return items[this.int(items.length)]
  }

  /** Poisson-distributed count with mean `lambda` (Knuth's method). */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0
    const limit = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k += 1
      p *= this.next()
    } while (p > limit)
    return k - 1
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1)
      const tmp = items[i]
      items[i] = items[j]
      items[j] = tmp
    }
    return items
  }
}
