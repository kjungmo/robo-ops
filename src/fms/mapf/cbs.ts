/**
 * Conflict-Based Search (Sharon et al., 2015), windowed variant.
 *
 * High level: best-first search over constraint-tree nodes ordered by
 * sum-of-costs, then number of conflicts, then creation order. Low level:
 * space-time A* under the node's constraints for one agent (plus an optional
 * base constraint source, e.g. reservations of agents outside the CBS set).
 * Vertex and edge (swap) conflicts are resolved by branching into two children
 * with one negative constraint each. Conflicts are only detected up to the
 * horizon, so with an unbounded horizon this is standard optimal CBS.
 */
import type { Cell, GridMap } from '../map/grid'
import { DistanceOracle } from '../map/grid'
import { CompositeConstraints, ConstraintSet, type Constraints } from './constraints'
import { findFirstConflict, countConflicts } from './conflicts'
import { spaceTimeAStar } from './spacetime_astar'
import type { PPAgent } from './prioritized'

export interface CBSOptions {
  maxNodes?: number
}

export interface CBSResult {
  status: 'ok' | 'infeasible' | 'limit'
  paths: Map<number, Cell[]>
  /** Agents with no individually feasible path (status 'infeasible'). */
  infeasible: number[]
  cost: number
  nodes: number
  expansions: number
  astarCalls: number
}

interface CTNode {
  constraints: Map<number, ConstraintSet>
  paths: Map<number, Cell[]>
  costs: Map<number, number>
  cost: number
  conflicts: number
  seq: number
}

export function cbs(
  map: GridMap,
  oracle: DistanceOracle,
  agents: readonly PPAgent[],
  base: Constraints | null,
  startTime: number,
  horizon: number,
  options: CBSOptions = {},
): CBSResult {
  const maxNodes = options.maxNodes ?? 5000
  const V = map.width * map.height
  const window = horizon - startTime
  let expansions = 0
  let astarCalls = 0
  let seq = 0

  const planAgent = (agent: PPAgent, cs: ConstraintSet) => {
    const cons = base ? new CompositeConstraints([base, cs]) : cs
    astarCalls += 1
    const r = spaceTimeAStar(map, oracle, agent.start, agent.goal, cons, startTime)
    if (r) expansions += r.expansions
    return r
  }

  const root: CTNode = {
    constraints: new Map(),
    paths: new Map(),
    costs: new Map(),
    cost: 0,
    conflicts: 0,
    seq: seq++,
  }
  const infeasible: number[] = []
  for (const a of agents) {
    const cs = new ConstraintSet(V, horizon)
    root.constraints.set(a.id, cs)
    const r = planAgent(a, cs)
    if (!r) {
      infeasible.push(a.id)
      continue
    }
    root.paths.set(a.id, r.path)
    root.costs.set(a.id, r.cost)
    root.cost += r.cost
  }
  if (infeasible.length > 0) {
    return { status: 'infeasible', paths: new Map(), infeasible, cost: 0, nodes: 1, expansions, astarCalls }
  }
  root.conflicts = countConflicts(root.paths, window)

  const open: CTNode[] = [root]
  const better = (x: CTNode, y: CTNode) =>
    x.cost !== y.cost ? x.cost < y.cost : x.conflicts !== y.conflicts ? x.conflicts < y.conflicts : x.seq < y.seq
  const popBest = (): CTNode => {
    let bi = 0
    for (let i = 1; i < open.length; i += 1) if (better(open[i], open[bi])) bi = i
    const n = open[bi]
    open[bi] = open[open.length - 1]
    open.pop()
    return n
  }
  const byId = new Map<number, PPAgent>()
  for (const a of agents) byId.set(a.id, a)

  let generated = 1
  while (open.length > 0) {
    const node = popBest()
    const conflict = findFirstConflict(node.paths, window)
    if (!conflict) {
      return { status: 'ok', paths: node.paths, infeasible: [], cost: node.cost, nodes: generated, expansions, astarCalls }
    }
    if (generated >= maxNodes) {
      return { status: 'limit', paths: new Map(), infeasible: [], cost: 0, nodes: generated, expansions, astarCalls }
    }
    const children: Array<{ agent: number; cs: ConstraintSet }> = []
    if (conflict.type === 'vertex') {
      children.push({ agent: conflict.a, cs: (node.constraints.get(conflict.a) as ConstraintSet).withVertex(conflict.cell, startTime + conflict.t) })
      children.push({ agent: conflict.b, cs: (node.constraints.get(conflict.b) as ConstraintSet).withVertex(conflict.cell, startTime + conflict.t) })
    } else {
      // Agent a moves from -> to; agent b moves to -> from.
      children.push({ agent: conflict.a, cs: (node.constraints.get(conflict.a) as ConstraintSet).withEdge(conflict.from, conflict.to, startTime + conflict.t) })
      children.push({ agent: conflict.b, cs: (node.constraints.get(conflict.b) as ConstraintSet).withEdge(conflict.to, conflict.from, startTime + conflict.t) })
    }
    for (const child of children) {
      const agent = byId.get(child.agent) as PPAgent
      const r = planAgent(agent, child.cs)
      if (!r) continue
      const constraints = new Map(node.constraints)
      constraints.set(child.agent, child.cs)
      const paths = new Map(node.paths)
      paths.set(child.agent, r.path)
      const costs = new Map(node.costs)
      costs.set(child.agent, r.cost)
      const cost = node.cost - (node.costs.get(child.agent) as number) + r.cost
      open.push({ constraints, paths, costs, cost, conflicts: countConflicts(paths, window), seq: seq++ })
      generated += 1
    }
  }
  // Open list exhausted: some agent cannot be constrained into a valid path.
  return { status: 'infeasible', paths: new Map(), infeasible: agents.map((a) => a.id), cost: 0, nodes: generated, expansions, astarCalls }
}
