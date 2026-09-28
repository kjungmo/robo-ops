import { describe, expect, it } from 'vitest'
import { hungarian, assignmentCost } from '../alloc/hungarian'
import { greedyAssign } from '../alloc/greedy'
import { Rng } from '../core/rng'

/** Exhaustive optimum over all partial injections rows -> columns (feasible pairs only). */
function bruteForce(cost: number[][]): number {
  const n = cost.length
  const m = n === 0 ? 0 : cost[0].length
  let best = Number.POSITIVE_INFINITY
  let bestMatches = -1
  const used = new Array<boolean>(m).fill(false)
  const rec = (i: number, total: number, matches: number) => {
    if (i === n) {
      // Primary objective: max feasible matches; secondary: min cost (mirrors BIG pricing).
      if (matches > bestMatches || (matches === bestMatches && total < best)) {
        best = total
        bestMatches = matches
      }
      return
    }
    rec(i + 1, total, matches)
    for (let j = 0; j < m; j += 1) {
      if (used[j] || !Number.isFinite(cost[i][j])) continue
      used[j] = true
      rec(i + 1, total + cost[i][j], matches + 1)
      used[j] = false
    }
  }
  rec(0, 0, 0)
  return best
}

function countMatches(a: number[]): number {
  return a.filter((j) => j >= 0).length
}

describe('hungarian', () => {
  it('matches brute force on random square and rectangular matrices', () => {
    const rng = new Rng(42)
    for (let trial = 0; trial < 300; trial += 1) {
      const n = 1 + rng.int(6)
      const m = 1 + rng.int(6)
      const cost = Array.from({ length: n }, () => Array.from({ length: m }, () => rng.int(20)))
      const a = hungarian(cost)
      expect(a.length).toBe(n)
      const cols = a.filter((j) => j >= 0)
      expect(new Set(cols).size).toBe(cols.length)
      expect(countMatches(a)).toBe(Math.min(n, m))
      expect(assignmentCost(cost, a)).toBe(bruteForce(cost))
    }
  })

  it('handles infeasible (Infinity) pairs by maximising feasible matches then cost', () => {
    const rng = new Rng(7)
    for (let trial = 0; trial < 300; trial += 1) {
      const n = 1 + rng.int(5)
      const m = 1 + rng.int(5)
      const cost = Array.from({ length: n }, () =>
        Array.from({ length: m }, () => (rng.next() < 0.35 ? Number.POSITIVE_INFINITY : rng.int(15))),
      )
      const a = hungarian(cost)
      for (let i = 0; i < n; i += 1) if (a[i] >= 0) expect(Number.isFinite(cost[i][a[i]])).toBe(true)
      const cols = a.filter((j) => j >= 0)
      expect(new Set(cols).size).toBe(cols.length)
      // Exhaustive: max matches, then min cost.
      const bf = bruteForce(cost)
      expect(assignmentCost(cost, a)).toBe(bf)
    }
  })

  it('is never worse than greedy', () => {
    const rng = new Rng(99)
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 2 + rng.int(6)
      const m = 2 + rng.int(6)
      const cost = Array.from({ length: n }, () => Array.from({ length: m }, () => rng.int(30)))
      const h = hungarian(cost)
      const g = greedyAssign(cost)
      expect(countMatches(h)).toBe(countMatches(g))
      expect(assignmentCost(cost, h)).toBeLessThanOrEqual(assignmentCost(cost, g))
    }
  })

  it('handles empty inputs', () => {
    expect(hungarian([])).toEqual([])
    expect(hungarian([[]])).toEqual([-1])
  })
})
