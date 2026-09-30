/**
 * Assignment cost models shared by all allocation methods.
 *
 * A robot r with state of charge s_r is priced for task tau by
 *   c(r, tau) = a(r, tau) * (1 + w_b * (1 - s_r))
 * where a(r, tau) is an estimate of the time needed to reach the pickup:
 *   - static     : exact free-space shortest-path distance (BFS);
 *   - proxy      : static distance plus a congestion penalty counted from the
 *                  reservation table along the shortest path;
 *   - path-aware : arrival time of a space-time A* plan against the current
 *                  reservation table (MAPF-in-the-loop).
 * The pair is infeasible (cost = Infinity) when the robot could not complete
 * pickup -> delivery -> nearest charger with its current charge.
 */
import type { Cell, GridMap } from '../map/grid'
import { chargerSlots, DistanceOracle } from '../map/grid'
import type { BatteryModel } from '../charging/policy'

export interface CostContext {
  readonly map: GridMap
  readonly oracle: DistanceOracle
  readonly battery: BatteryModel
  /** Weight of the battery-state term; 0 disables it. */
  readonly wBattery: number
}

export interface TaskLike {
  readonly pickup: Cell
  readonly delivery: Cell
}

export function nearestChargerDistance(ctx: CostContext, from: Cell): number {
  let best = Number.POSITIVE_INFINITY
  for (const slot of chargerSlots(ctx.map)) {
    const d = ctx.oracle.dist(from, slot)
    if (d < best) best = d
  }
  return best
}

/** Energy (in SoC units) needed to travel `steps` moves plus the safety reserve. */
export function energyForSteps(ctx: CostContext, steps: number): number {
  return steps * ctx.battery.drainMove + ctx.battery.reserve
}

/**
 * Whether robot at `cell` with charge `soc` can execute task and still reach a
 * charger afterwards. `toPickup` lets callers substitute a path-aware estimate.
 */
export function taskFeasible(ctx: CostContext, cell: Cell, soc: number, task: TaskLike, toPickup?: number): boolean {
  const d1 = toPickup ?? ctx.oracle.dist(cell, task.pickup)
  const d2 = ctx.oracle.dist(task.pickup, task.delivery)
  const dc = nearestChargerDistance(ctx, task.delivery)
  if (!Number.isFinite(d1) || !Number.isFinite(d2) || !Number.isFinite(dc)) return false
  return soc >= energyForSteps(ctx, d1 + d2 + dc)
}

export function batteryFactor(ctx: CostContext, soc: number): number {
  return 1 + ctx.wBattery * (1 - Math.min(1, Math.max(0, soc)))
}

/** Static (free-space) cost. */
export function staticCost(ctx: CostContext, cell: Cell, soc: number, task: TaskLike): number {
  if (!taskFeasible(ctx, cell, soc, task)) return Number.POSITIVE_INFINITY
  return ctx.oracle.dist(cell, task.pickup) * batteryFactor(ctx, soc)
}

/** Cost from an externally supplied arrival-time estimate (proxy or path-aware). */
export function estimatedCost(ctx: CostContext, cell: Cell, soc: number, task: TaskLike, arrival: number): number {
  if (!Number.isFinite(arrival)) return Number.POSITIVE_INFINITY
  if (!taskFeasible(ctx, cell, soc, task, arrival)) return Number.POSITIVE_INFINITY
  return arrival * batteryFactor(ctx, soc)
}
