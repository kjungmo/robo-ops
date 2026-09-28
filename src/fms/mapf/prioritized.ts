/**
 * Prioritized planning (Erdmann & Lozano-Perez 1987; Silver 2005) with a
 * reservation table and a hold-cascade fallback.
 *
 * Agents are planned one at a time in the given priority order; every planned
 * path is written into the shared reservation table so later agents treat it
 * as a moving obstacle. If an agent has no feasible path within the window it
 * "holds": it reserves its start cell for the whole window. Any agent whose
 * reserved path crossed that cell (from this call or from `external` agents
 * planned earlier into the same table) is then re-planned against the new
 * hold. Holds only accumulate, so the cascade terminates after at most |A|
 * holds, and at a fixed point every path is consistent with every reservation,
 * which is exactly the conflict-free invariant (Proposition 1 in the paper).
 */
import type { Cell, GridMap } from '../map/grid'
import { DistanceOracle } from '../map/grid'
import { ReservationTable } from './constraints'
import { spaceTimeAStar } from './spacetime_astar'

export interface PPAgent {
  readonly id: number
  readonly start: Cell
  readonly goal: Cell
}

export interface PPResult {
  /** Paths for every agent in `agents` plus any external agent that was re-planned. */
  paths: Map<number, Cell[]>
  /** Agents that fell back to holding their start cell. */
  held: Set<number>
  expansions: number
  astarCalls: number
}

export function prioritizedPlan(
  map: GridMap,
  oracle: DistanceOracle,
  agents: readonly PPAgent[],
  table: ReservationTable,
  startTime: number,
  external: readonly PPAgent[] = [],
): PPResult {
  const order = new Map<number, number>()
  external.forEach((a, i) => order.set(a.id, i))
  agents.forEach((a, i) => order.set(a.id, external.length + i))
  const byId = new Map<number, PPAgent>()
  for (const a of external) byId.set(a.id, a)
  for (const a of agents) byId.set(a.id, a)
  const paths = new Map<number, Cell[]>()
  const held = new Set<number>()
  const queue: PPAgent[] = [...agents]
  let expansions = 0
  let astarCalls = 0

  while (queue.length > 0) {
    const agent = queue.shift() as PPAgent
    astarCalls += 1
    let result = spaceTimeAStar(map, oracle, agent.start, agent.goal, table, startTime)
    if (result) expansions += result.expansions
    if (result === null) {
      held.add(agent.id)
      result = { path: [agent.start], cost: 0, expansions: 0 }
      // Cascade: every agent reserved on the held cell within the window must re-plan.
      const victimIds = new Set<number>()
      for (let t = startTime; t <= table.horizon; t += 1) {
        const occ = table.occupant(agent.start, t)
        if (occ >= 0 && occ !== agent.id && !held.has(occ) && byId.has(occ)) victimIds.add(occ)
      }
      const victims = [...victimIds].map((id) => byId.get(id) as PPAgent)
      for (const v of victims) {
        table.releaseAgent(v.id)
        paths.delete(v.id)
      }
      victims.sort((a, b) => (order.get(a.id) as number) - (order.get(b.id) as number))
      queue.unshift(...victims)
    }
    paths.set(agent.id, result.path)
    table.reservePath(agent.id, result.path, startTime)
  }
  return { paths, held, expansions, astarCalls }
}
