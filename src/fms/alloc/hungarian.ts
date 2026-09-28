/**
 * Hungarian (Kuhn-Munkres) algorithm for the rectangular linear assignment
 * problem, O(n^2 m) with potentials (Jonker-Volgenant style shortest
 * augmenting paths).
 *
 * `cost[i][j]` may be `Infinity` to mark an infeasible pair. Returns, for each
 * row i, the column assigned to it or -1 when the row is left unassigned
 * (either because there are fewer columns than rows or because every column
 * that could be matched to it is infeasible). The assignment minimises the
 * total cost over all feasible complete matchings and, because infeasible
 * pairs are priced above the sum of all finite costs, it also maximises the
 * number of feasible matches.
 */
const INFEASIBLE = Number.POSITIVE_INFINITY

export function hungarian(cost: number[][]): number[] {
  const n = cost.length
  if (n === 0) return []
  const m = cost[0].length
  if (m === 0) return new Array<number>(n).fill(-1)
  if (n > m) {
    // Solve the transposed problem and invert the mapping.
    const transposed: number[][] = []
    for (let j = 0; j < m; j += 1) {
      const row: number[] = []
      for (let i = 0; i < n; i += 1) row.push(cost[i][j])
      transposed.push(row)
    }
    const colToRow = hungarian(transposed)
    const out = new Array<number>(n).fill(-1)
    for (let j = 0; j < m; j += 1) if (colToRow[j] >= 0) out[colToRow[j]] = j
    return out
  }
  let finiteSum = 0
  for (const row of cost) for (const c of row) if (Number.isFinite(c)) finiteSum += Math.abs(c)
  const BIG = finiteSum + 1e6
  const a = (i: number, j: number) => {
    const c = cost[i - 1][j - 1]
    return Number.isFinite(c) ? c : BIG
  }
  const u = new Float64Array(n + 1)
  const v = new Float64Array(m + 1)
  const p = new Int32Array(m + 1)
  const way = new Int32Array(m + 1)
  for (let i = 1; i <= n; i += 1) {
    p[0] = i
    let j0 = 0
    const minv = new Float64Array(m + 1).fill(INFEASIBLE)
    const used = new Uint8Array(m + 1)
    do {
      used[j0] = 1
      const i0 = p[j0]
      let delta = INFEASIBLE
      let j1 = 0
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue
        const cur = a(i0, j) - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0 !== 0)
  }
  const assignment = new Array<number>(n).fill(-1)
  for (let j = 1; j <= m; j += 1) {
    if (p[j] !== 0 && Number.isFinite(cost[p[j] - 1][j - 1])) assignment[p[j] - 1] = j - 1
  }
  return assignment
}

/** Total cost of an assignment (rows with -1 contribute nothing). */
export function assignmentCost(cost: number[][], assignment: number[]): number {
  let total = 0
  for (let i = 0; i < assignment.length; i += 1) {
    if (assignment[i] >= 0) total += cost[i][assignment[i]]
  }
  return total
}
