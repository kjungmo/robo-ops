/**
 * Conflict detection for sets of time-indexed paths.
 *
 * Paths are relative: path[k] is the cell at time k. An agent whose path is
 * shorter than the others rests on its last cell. Following conflicts (an
 * agent entering a cell that another agent just left) are permitted, matching
 * the reservation semantics of the planners.
 */
import type { Cell } from '../map/grid'

export type Conflict =
  | { type: 'vertex'; a: number; b: number; t: number; cell: Cell }
  | { type: 'edge'; a: number; b: number; t: number; from: Cell; to: Cell }

function at(path: readonly Cell[], k: number): Cell {
  return path[Math.min(k, path.length - 1)]
}

/**
 * Earliest conflict among `paths` (keys are agent ids), considering times
 * 0..maxTime inclusive. Returns null when conflict-free.
 */
export function findFirstConflict(paths: ReadonlyMap<number, readonly Cell[]>, maxTime: number): Conflict | null {
  const ids = [...paths.keys()]
  let T = 0
  for (const p of paths.values()) T = Math.max(T, p.length - 1)
  T = Math.min(T, maxTime)
  for (let t = 0; t <= T; t += 1) {
    const occ = new Map<Cell, number>()
    for (const id of ids) {
      const p = paths.get(id) as readonly Cell[]
      const c = at(p, t)
      const other = occ.get(c)
      if (other !== undefined) return { type: 'vertex', a: other, b: id, t, cell: c }
      occ.set(c, id)
    }
    if (t === T) break
    // Swap conflicts between t and t+1.
    const moves = new Map<number, number>()
    for (const id of ids) {
      const p = paths.get(id) as readonly Cell[]
      const from = at(p, t)
      const to = at(p, t + 1)
      if (from === to) continue
      const reverse = moves.get(to * 1e6 + from)
      if (reverse !== undefined) return { type: 'edge', a: reverse, b: id, t, from: to, to: from }
      moves.set(from * 1e6 + to, id)
    }
  }
  return null
}

export function countConflicts(paths: ReadonlyMap<number, readonly Cell[]>, maxTime: number): number {
  const ids = [...paths.keys()]
  let T = 0
  for (const p of paths.values()) T = Math.max(T, p.length - 1)
  T = Math.min(T, maxTime)
  let n = 0
  for (let t = 0; t <= T; t += 1) {
    const occ = new Map<Cell, number>()
    for (const id of ids) {
      const c = at(paths.get(id) as readonly Cell[], t)
      if (occ.has(c)) n += 1
      else occ.set(c, id)
    }
    if (t === T) break
    const moves = new Set<number>()
    for (const id of ids) {
      const p = paths.get(id) as readonly Cell[]
      const from = at(p, t)
      const to = at(p, t + 1)
      if (from === to) continue
      if (moves.has(to * 1e6 + from)) n += 1
      moves.add(from * 1e6 + to)
    }
  }
  return n
}

/** Conflicts in a single synchronous step given previous and next cells per agent. */
export function stepConflicts(prev: readonly Cell[], next: readonly Cell[]): number {
  let n = 0
  const occ = new Map<Cell, number>()
  for (let i = 0; i < next.length; i += 1) {
    if (occ.has(next[i])) n += 1
    else occ.set(next[i], i)
  }
  const moves = new Map<number, number>()
  for (let i = 0; i < next.length; i += 1) {
    if (prev[i] === next[i]) continue
    if (moves.has(next[i] * 1e6 + prev[i])) n += 1
    moves.set(prev[i] * 1e6 + next[i], i)
  }
  return n
}
