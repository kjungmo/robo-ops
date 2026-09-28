/**
 * Space-time constraints consumed by the low-level planner.
 *
 * All times are absolute simulation ticks. A constraint source is only
 * consulted for times t <= horizon; beyond the horizon the planner is
 * unconstrained (windowed planning in the sense of RHCR, Li et al. 2021).
 *
 * Two implementations:
 *  - {@link ReservationTable}: vertex/edge reservations plus "holds" (an agent
 *    resting on a cell from some time onward), used by prioritized planning.
 *  - {@link ConstraintSet}: per-agent negative constraints produced by CBS.
 */
import type { Cell } from '../map/grid'

export interface Constraints {
  /** Last absolute time at which constraints apply (inclusive). */
  readonly horizon: number
  /** May an agent occupy `cell` at absolute time `t`? */
  vertexFree(cell: Cell, t: number): boolean
  /** May an agent traverse `from -> to` during [t, t+1]? (swap check) */
  edgeFree(from: Cell, to: Cell, t: number): boolean
  /** May an agent arrive at `cell` at time `t` and rest there until the horizon? */
  goalFree(cell: Cell, t: number): boolean
}

export class ReservationTable implements Constraints {
  private readonly vertices = new Map<number, number>()
  private readonly edges = new Map<number, number>()
  private readonly holds = new Map<Cell, { from: number; agent: number }>()
  private readonly byAgent = new Map<number, { v: number[]; e: number[]; hold: Cell | null }>()
  readonly cells: number
  readonly horizon: number

  constructor(cells: number, horizon: number) {
    this.cells = cells
    this.horizon = horizon
  }

  private vkey(cell: Cell, t: number): number {
    return t * this.cells + cell
  }

  private ekey(from: Cell, to: Cell, t: number): number {
    return (t * this.cells + from) * this.cells + to
  }

  vertexFree(cell: Cell, t: number): boolean {
    if (t > this.horizon) return true
    if (this.vertices.has(this.vkey(cell, t))) return false
    const hold = this.holds.get(cell)
    return hold === undefined || hold.from > t
  }

  edgeFree(from: Cell, to: Cell, t: number): boolean {
    if (t >= this.horizon) return true
    return !this.edges.has(this.ekey(to, from, t))
  }

  goalFree(cell: Cell, t: number): boolean {
    if (this.holds.has(cell)) return false
    for (let tt = t; tt <= this.horizon; tt += 1) {
      if (this.vertices.has(this.vkey(cell, tt))) return false
    }
    return true
  }

  /** Who occupies `cell` at `t` (vertex reservation or hold), or -1. */
  occupant(cell: Cell, t: number): number {
    const v = this.vertices.get(this.vkey(cell, t))
    if (v !== undefined) return v
    const hold = this.holds.get(cell)
    if (hold && hold.from <= t) return hold.agent
    return -1
  }

  hasHold(cell: Cell): boolean {
    return this.holds.has(cell)
  }

  /**
   * Reserve `path` for `agent` starting at absolute time `startTime`
   * (path[k] is occupied at startTime + k). Reservations are truncated at the
   * horizon. If the path ends at or before the horizon the agent is assumed to
   * rest at its last cell until the horizon (`hold`).
   */
  reservePath(agent: number, path: readonly Cell[], startTime: number): void {
    this.releaseAgent(agent)
    const rec = { v: [] as number[], e: [] as number[], hold: null as Cell | null }
    for (let k = 0; k < path.length; k += 1) {
      const t = startTime + k
      if (t > this.horizon) break
      const vk = this.vkey(path[k], t)
      this.vertices.set(vk, agent)
      rec.v.push(vk)
      if (k + 1 < path.length && t < this.horizon && path[k] !== path[k + 1]) {
        const ek = this.ekey(path[k], path[k + 1], t)
        this.edges.set(ek, agent)
        rec.e.push(ek)
      }
    }
    const endTime = startTime + path.length - 1
    if (endTime <= this.horizon) {
      const last = path[path.length - 1]
      this.holds.set(last, { from: endTime, agent })
      rec.hold = last
    }
    this.byAgent.set(agent, rec)
  }

  /** Reserve a cell for `agent` from `fromTime` until the horizon. */
  reserveHold(agent: number, cell: Cell, fromTime: number): void {
    this.reservePath(agent, [cell], fromTime)
  }

  releaseAgent(agent: number): void {
    const rec = this.byAgent.get(agent)
    if (!rec) return
    for (const vk of rec.v) if (this.vertices.get(vk) === agent) this.vertices.delete(vk)
    for (const ek of rec.e) if (this.edges.get(ek) === agent) this.edges.delete(ek)
    if (rec.hold !== null) {
      const h = this.holds.get(rec.hold)
      if (h && h.agent === agent) this.holds.delete(rec.hold)
    }
    this.byAgent.delete(agent)
  }

  /**
   * Congestion proxy: number of (cell, time) slots along `path` (starting at
   * `startTime`) that are reserved by other agents, with a held cell counted
   * as `holdPenalty` because it blocks for the rest of the window.
   */
  congestionAlong(path: readonly Cell[], startTime: number, holdPenalty: number): number {
    let n = 0
    for (let k = 0; k < path.length; k += 1) {
      const t = startTime + k
      if (t > this.horizon) break
      if (this.holds.has(path[k])) {
        n += holdPenalty
        continue
      }
      if (this.vertices.has(this.vkey(path[k], t))) n += 1
      else if (this.vertices.has(this.vkey(path[k], t + 1)) || (t > 0 && this.vertices.has(this.vkey(path[k], t - 1)))) n += 1
    }
    return n
  }
}

/** Negative constraints for one agent (CBS). Immutable once shared; copy to extend. */
export class ConstraintSet implements Constraints {
  private readonly vertices: Set<number>
  private readonly edges: Set<number>
  readonly cells: number
  readonly horizon: number

  constructor(cells: number, horizon: number, vertices?: Set<number>, edges?: Set<number>) {
    this.cells = cells
    this.horizon = horizon
    this.vertices = vertices ?? new Set()
    this.edges = edges ?? new Set()
  }

  private vkey(cell: Cell, t: number): number {
    return t * this.cells + cell
  }

  private ekey(from: Cell, to: Cell, t: number): number {
    return (t * this.cells + from) * this.cells + to
  }

  withVertex(cell: Cell, t: number): ConstraintSet {
    const v = new Set(this.vertices)
    v.add(this.vkey(cell, t))
    return new ConstraintSet(this.cells, this.horizon, v, this.edges)
  }

  withEdge(from: Cell, to: Cell, t: number): ConstraintSet {
    const e = new Set(this.edges)
    e.add(this.ekey(from, to, t))
    return new ConstraintSet(this.cells, this.horizon, this.vertices, e)
  }

  get size(): number {
    return this.vertices.size + this.edges.size
  }

  vertexFree(cell: Cell, t: number): boolean {
    return t > this.horizon || !this.vertices.has(this.vkey(cell, t))
  }

  edgeFree(from: Cell, to: Cell, t: number): boolean {
    return t >= this.horizon || !this.edges.has(this.ekey(from, to, t))
  }

  goalFree(cell: Cell, t: number): boolean {
    for (let tt = t; tt <= this.horizon; tt += 1) {
      if (this.vertices.has(this.vkey(cell, tt))) return false
    }
    return true
  }
}

/** Conjunction of several constraint sources. */
export class CompositeConstraints implements Constraints {
  readonly horizon: number
  private readonly parts: readonly Constraints[]

  constructor(parts: readonly Constraints[]) {
    this.parts = parts
    this.horizon = Math.max(...parts.map((p) => p.horizon))
  }

  vertexFree(cell: Cell, t: number): boolean {
    for (const p of this.parts) if (!p.vertexFree(cell, t)) return false
    return true
  }

  edgeFree(from: Cell, to: Cell, t: number): boolean {
    for (const p of this.parts) if (!p.edgeFree(from, to, t)) return false
    return true
  }

  goalFree(cell: Cell, t: number): boolean {
    for (const p of this.parts) if (!p.goalFree(cell, t)) return false
    return true
  }
}

export class NoConstraints implements Constraints {
  readonly horizon: number
  constructor(horizon: number) {
    this.horizon = horizon
  }
  vertexFree(): boolean {
    return true
  }
  edgeFree(): boolean {
    return true
  }
  goalFree(): boolean {
    return true
  }
}
