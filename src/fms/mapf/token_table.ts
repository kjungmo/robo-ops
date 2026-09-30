/**
 * Unwindowed reservation table for token passing (Ma et al., 2017).
 *
 * The token holds the complete paths of all robots. Every path ends with a
 * permanent rest at its last cell, so a robot whose path has ended is a static
 * obstacle until it re-plans. There is no horizon: `vertexFree`, `edgeFree`
 * and `goalFree` constrain all future times, and space-time A* on this table
 * must be bounded by an expansion limit instead of a window.
 */
import type { Cell } from '../map/grid'
import type { Constraints } from './constraints'

interface Entry {
  path: readonly Cell[]
  start: number
}

export class TokenTable implements Constraints {
  readonly horizon = Number.POSITIVE_INFINITY
  private readonly cells: number
  private readonly vertices = new Map<number, number>()
  private readonly edges = new Map<number, number>()
  /** Permanent rests: cell -> (from, agent). */
  private readonly rests = new Map<Cell, { from: number; agent: number }>()
  /** Last reserved time per cell per agent (for goalFree). */
  private readonly lastVisit = new Map<Cell, Map<number, number>>()
  private readonly byAgent = new Map<number, Entry>()

  constructor(cells: number) {
    this.cells = cells
  }

  private vkey(cell: Cell, t: number): number {
    return t * this.cells + cell
  }

  private ekey(from: Cell, to: Cell, t: number): number {
    return (t * this.cells + from) * this.cells + to
  }

  vertexFree(cell: Cell, t: number): boolean {
    if (this.vertices.has(this.vkey(cell, t))) return false
    const rest = this.rests.get(cell)
    return rest === undefined || rest.from > t
  }

  edgeFree(from: Cell, to: Cell, t: number): boolean {
    return !this.edges.has(this.ekey(to, from, t))
  }

  goalFree(cell: Cell, t: number): boolean {
    if (this.rests.has(cell)) return false
    const visits = this.lastVisit.get(cell)
    if (visits) for (const last of visits.values()) if (last >= t) return false
    return true
  }

  /** Cell where `agent`'s path ends (its permanent rest), or -1. */
  endOf(agent: number): Cell {
    const e = this.byAgent.get(agent)
    return e ? e.path[e.path.length - 1] : -1
  }

  entry(agent: number): Entry | undefined {
    return this.byAgent.get(agent)
  }

  /** Reserve `path` from absolute time `start`, ending with a permanent rest. */
  reservePath(agent: number, path: readonly Cell[], start: number): void {
    this.releaseAgent(agent)
    for (let k = 0; k < path.length; k += 1) {
      const t = start + k
      this.vertices.set(this.vkey(path[k], t), agent)
      let visits = this.lastVisit.get(path[k])
      if (!visits) {
        visits = new Map()
        this.lastVisit.set(path[k], visits)
      }
      visits.set(agent, Math.max(visits.get(agent) ?? -1, t))
      if (k + 1 < path.length && path[k] !== path[k + 1]) this.edges.set(this.ekey(path[k], path[k + 1], t), agent)
    }
    this.rests.set(path[path.length - 1], { from: start + path.length - 1, agent })
    this.byAgent.set(agent, { path, start })
  }

  releaseAgent(agent: number): void {
    const e = this.byAgent.get(agent)
    if (!e) return
    const { path, start } = e
    for (let k = 0; k < path.length; k += 1) {
      const t = start + k
      const vk = this.vkey(path[k], t)
      if (this.vertices.get(vk) === agent) this.vertices.delete(vk)
      this.lastVisit.get(path[k])?.delete(agent)
      if (k + 1 < path.length) {
        const ek = this.ekey(path[k], path[k + 1], t)
        if (this.edges.get(ek) === agent) this.edges.delete(ek)
      }
    }
    const last = path[path.length - 1]
    const rest = this.rests.get(last)
    if (rest && rest.agent === agent) this.rests.delete(last)
    this.byAgent.delete(agent)
  }
}

/**
 * View of a table in which reaching `goal` only requires the goal to stay free
 * for `dwell` further ticks (a pickup the robot will leave again), instead of
 * a permanent rest.
 */
export class DwellGoal implements Constraints {
  readonly horizon: number
  private readonly base: Constraints
  private readonly dwell: number

  constructor(base: Constraints, dwell: number) {
    this.base = base
    this.dwell = dwell
    this.horizon = base.horizon
  }

  vertexFree(cell: Cell, t: number): boolean {
    return this.base.vertexFree(cell, t)
  }

  edgeFree(from: Cell, to: Cell, t: number): boolean {
    return this.base.edgeFree(from, to, t)
  }

  goalFree(cell: Cell, t: number): boolean {
    for (let k = 0; k <= this.dwell; k += 1) if (!this.base.vertexFree(cell, t + k)) return false
    return true
  }
}
