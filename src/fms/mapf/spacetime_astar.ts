/**
 * Windowed space-time A* (Silver, 2005) on the (cell, time) graph.
 *
 * The search runs from absolute time `startTime` up to `constraints.horizon`.
 * Beyond the horizon no constraints exist, so a state at the horizon is closed
 * with the exact remaining free-space distance and the path is completed with
 * a deterministic shortest path. The heuristic is the exact BFS distance, hence
 * consistent, and the first goal state popped is optimal in arrival time.
 *
 * Returned cost = arrival time at the goal relative to `startTime`
 * (the number of move + wait actions), the standard per-agent cost in
 * sum-of-costs MAPF.
 */
import type { Cell, GridMap } from '../map/grid'
import { DistanceOracle, neighbors } from '../map/grid'
import type { Constraints } from './constraints'

export interface PlanResult {
  /** path[k] is the cell occupied at startTime + k; path[0] === start. */
  path: Cell[]
  /** Arrival time relative to startTime. */
  cost: number
  expansions: number
}

export interface AStarOptions {
  /** Abort after this many expansions (returns null). */
  maxExpansions?: number
}

class MinHeap {
  private f: number[] = []
  private g: number[] = []
  private seq: number[] = []
  private id: number[] = []
  private counter = 0

  get size(): number {
    return this.id.length
  }

  push(f: number, g: number, id: number): void {
    const seq = this.counter++
    this.f.push(f)
    this.g.push(g)
    this.seq.push(seq)
    this.id.push(id)
    this.up(this.id.length - 1)
  }

  pop(): number {
    const top = this.id[0]
    const lastIdx = this.id.length - 1
    this.swap(0, lastIdx)
    this.f.pop()
    this.g.pop()
    this.seq.pop()
    this.id.pop()
    if (this.id.length > 0) this.down(0)
    return top
  }

  private less(a: number, b: number): boolean {
    if (this.f[a] !== this.f[b]) return this.f[a] < this.f[b]
    // Tie-break on larger g (deeper), then FIFO for determinism.
    if (this.g[a] !== this.g[b]) return this.g[a] > this.g[b]
    return this.seq[a] < this.seq[b]
  }

  private swap(a: number, b: number): void {
    ;[this.f[a], this.f[b]] = [this.f[b], this.f[a]]
    ;[this.g[a], this.g[b]] = [this.g[b], this.g[a]]
    ;[this.seq[a], this.seq[b]] = [this.seq[b], this.seq[a]]
    ;[this.id[a], this.id[b]] = [this.id[b], this.id[a]]
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(i, p)) {
        this.swap(i, p)
        i = p
      } else break
    }
  }

  private down(i: number): void {
    const n = this.id.length
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < n && this.less(l, m)) m = l
      if (r < n && this.less(r, m)) m = r
      if (m === i) break
      this.swap(i, m)
      i = m
    }
  }
}

export function spaceTimeAStar(
  map: GridMap,
  oracle: DistanceOracle,
  start: Cell,
  goal: Cell,
  constraints: Constraints,
  startTime: number,
  options: AStarOptions = {},
): PlanResult | null {
  const h = oracle.toGoal(goal)
  if (h[start] < 0) return null
  const horizon = constraints.horizon
  const maxExpansions = options.maxExpansions ?? Number.POSITIVE_INFINITY
  const V = map.width * map.height
  // Node storage: cell, time, parent index.
  const nCell: number[] = []
  const nTime: number[] = []
  const nParent: number[] = []
  const closed = new Set<number>()
  const bestG = new Map<number, number>()
  const heap = new MinHeap()
  const key = (cell: Cell, t: number) => t * V + cell

  const pushNode = (cell: Cell, t: number, parent: number) => {
    const k = key(cell, t)
    const g = t - startTime
    const prev = bestG.get(k)
    if (prev !== undefined && prev <= g) return
    bestG.set(k, g)
    const idx = nCell.length
    nCell.push(cell)
    nTime.push(t)
    nParent.push(parent)
    heap.push(g + h[cell], g, idx)
  }

  if (!constraints.vertexFree(start, startTime)) return null
  pushNode(start, startTime, -1)
  let expansions = 0

  const reconstruct = (idx: number): Cell[] => {
    const rev: Cell[] = []
    let cur = idx
    while (cur >= 0) {
      rev.push(nCell[cur])
      cur = nParent[cur]
    }
    rev.reverse()
    return rev
  }

  while (heap.size > 0) {
    const idx = heap.pop()
    const cell = nCell[idx]
    const t = nTime[idx]
    const k = key(cell, t)
    if (closed.has(k)) continue
    closed.add(k)
    expansions += 1
    if (expansions > maxExpansions) return null

    if (cell === goal && constraints.goalFree(goal, t)) {
      return { path: reconstruct(idx), cost: t - startTime, expansions }
    }
    if (t >= horizon) {
      // Unconstrained beyond the horizon: append the exact shortest path.
      const path = reconstruct(idx)
      const tail = oracle.shortestPath(cell, goal)
      if (!tail) return null
      for (let i = 1; i < tail.length; i += 1) path.push(tail[i])
      return { path, cost: t - startTime + h[cell], expansions }
    }
    const nt = t + 1
    // Wait.
    if (constraints.vertexFree(cell, nt)) pushNode(cell, nt, idx)
    // Moves.
    for (const nb of neighbors(map, cell)) {
      if (h[nb] < 0) continue
      if (!constraints.vertexFree(nb, nt)) continue
      if (!constraints.edgeFree(cell, nb, t)) continue
      pushNode(nb, nt, idx)
    }
  }
  return null
}
