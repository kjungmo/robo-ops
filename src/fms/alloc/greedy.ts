/**
 * Greedy assignment baseline: repeatedly commit the globally cheapest
 * (row, column) pair among unassigned rows and columns. This is the
 * sequential-auction style heuristic common in fleet managers; it is O(nm log nm)
 * and has no optimality guarantee.
 */
export function greedyAssign(cost: number[][]): number[] {
  const n = cost.length
  const assignment = new Array<number>(n).fill(-1)
  if (n === 0) return assignment
  const m = cost[0].length
  const pairs: Array<{ c: number; i: number; j: number }> = []
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const c = cost[i][j]
      if (Number.isFinite(c)) pairs.push({ c, i, j })
    }
  }
  pairs.sort((a, b) => a.c - b.c || a.i - b.i || a.j - b.j)
  const colUsed = new Uint8Array(m)
  for (const { i, j } of pairs) {
    if (assignment[i] >= 0 || colUsed[j]) continue
    assignment[i] = j
    colUsed[j] = 1
  }
  return assignment
}
