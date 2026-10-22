/**
 * Tests of the properties that the paper states as a proposition, an algorithm
 * step or an equation: the horizon branch of the space-time A* (Algorithm 1),
 * the call bound of Proposition 1, the congestion proxy, the cost of Eq. (4),
 * pool admission and endpoint capacities, the stall detector, the conditional
 * charge proposition (Proposition 2), the coupling diagnostics and the
 * token-passing variants.
 */
import { describe, expect, it } from 'vitest'
import { Rng } from '../core/rng'
import { DistanceOracle, parseAsciiMap, chargerSlots, type Cell, type GridMap } from '../map/grid'
import { loadLayout } from '../map/layouts'
import { ReservationTable } from '../mapf/constraints'
import { spaceTimeAStar } from '../mapf/spacetime_astar'
import { prioritizedPlan, type PPAgent } from '../mapf/prioritized'
import { hungarian, INFEASIBLE_OFFSET } from '../alloc/hungarian'
import { batteryFactor, estimatedCost, staticCost, taskFeasible, type CostContext } from '../alloc/cost'
import { DEFAULT_BATTERY } from '../charging/policy'
import { DEFAULT_CONFIG, FleetSimulator, POOL_FACTOR, POOL_MIN, type SimConfig } from '../sim/simulator'
import { TrajectoryAuditor } from '../sim/audit'

function audited(cfg: Partial<SimConfig>, eachTick?: (sim: FleetSimulator) => void) {
  const sim = new FleetSimulator(cfg)
  const a = new TrajectoryAuditor(sim.map, sim.cfg.battery.socLow, sim)
  while (!sim.finished) {
    sim.step()
    a.observe(sim)
    eachTick?.(sim)
  }
  return { sim, m: sim.metrics(), audit: a.report() }
}

function freeCount(map: GridMap): number {
  let n = 0
  for (const b of map.blocked) if (b === 0) n += 1
  return n
}

describe('space-time A* (Algorithm 1)', () => {
  it('closes a state at the horizon with the free-space distance and stays within |V|(w+1) expansions', () => {
    const map = loadLayout('warehouse')
    const oracle = new DistanceOracle(map)
    const start = map.homes[0]
    const goal = map.deliveries[map.deliveries.length - 1]
    const d = oracle.dist(start, goal)
    for (const w of [5, 10, 20]) {
      expect(d).toBeGreaterThan(w)
      const table = new ReservationTable(map.width * map.height, 100 + w)
      const res = spaceTimeAStar(map, oracle, start, goal, table, 100)
      expect(res).not.toBeNull()
      // Empty table: the horizon state lies on a shortest path, so cost = (t - t0) + d(v, g) = d.
      expect(res?.cost).toBe(d)
      expect(res?.path.length).toBe(d + 1)
      expect(res?.path[res.path.length - 1]).toBe(goal)
      expect(res?.expansions).toBeLessThanOrEqual(freeCount(map) * (w + 1))
    }
  })

  it('adds the waits forced inside the window to the cost returned at the horizon', () => {
    // One-cell corridor: another agent holds the second cell for three ticks.
    const map = parseAsciiMap('corridor', ['#########', '#.......#', '#########'].join('\n'))
    const oracle = new DistanceOracle(map)
    const cell = (x: number) => map.width + x
    const table = new ReservationTable(map.width * map.height, 4)
    table.reservePath(9, [cell(2), cell(2), cell(2), cell(2), cell(3), cell(4), cell(5), cell(6), cell(7)], 0)
    const res = spaceTimeAStar(map, oracle, cell(1), cell(6), table, 0)
    expect(res).not.toBeNull()
    expect(oracle.dist(cell(1), cell(6))).toBe(5)
    expect(res?.cost).toBeGreaterThan(5)
  })

  it('fails at once when the start cell is reserved at the start time', () => {
    const map = parseAsciiMap('corridor', ['#####', '#...#', '#####'].join('\n'))
    const oracle = new DistanceOracle(map)
    const table = new ReservationTable(map.width * map.height, 10)
    table.reserveHold(1, map.width + 1, 0)
    expect(spaceTimeAStar(map, oracle, map.width + 1, map.width + 3, table, 0)).toBeNull()
  })
})

describe('prioritized planning (Proposition 1)', () => {
  it('calls the low-level planner at most N(N+1)/2 times', () => {
    const rng = new Rng(23)
    let cascades = 0
    for (let trial = 0; trial < 400; trial += 1) {
      const w = 5 + rng.int(4)
      const h = 4 + rng.int(3)
      const rows: string[] = []
      for (let y = 0; y < h; y += 1) {
        let row = ''
        for (let x = 0; x < w; x += 1) row += rng.next() < 0.25 ? '#' : '.'
        rows.push(row)
      }
      const map = parseAsciiMap('rand', rows.join('\n'))
      const oracle = new DistanceOracle(map)
      const cells: Cell[] = []
      for (let c = 0; c < map.blocked.length; c += 1) if (map.blocked[c] === 0) cells.push(c)
      const n = 3 + rng.int(6)
      if (cells.length < n) continue
      const starts = rng.shuffle([...cells]).slice(0, n)
      const goals = rng.shuffle([...cells]).slice(0, n)
      const agents: PPAgent[] = starts.map((s, i) => ({ id: i, start: s, goal: goals[i] }))
      const table = new ReservationTable(map.width * map.height, 6 + rng.int(10))
      const res = prioritizedPlan(map, oracle, agents, table, 0)
      expect(res.astarCalls).toBeLessThanOrEqual((n * (n + 1)) / 2)
      expect(res.astarCalls).toBeGreaterThanOrEqual(n)
      if (res.astarCalls > n) cascades += 1
    }
    // The bound is exercised: some instances need re-planning after a hold.
    expect(cascades).toBeGreaterThan(10)
  })
})

describe('congestion proxy', () => {
  it('counts a reservation at the traversal tick, one tick earlier or one tick later, and a hold as the hold penalty', () => {
    const cells = 100
    const path = [10, 11, 12, 13]
    const count = (other: Cell[], start: number, horizon = 50) => {
      const table = new ReservationTable(cells, horizon)
      table.reservePath(7, other, start)
      return table.congestionAlong(path, 0, 10)
    }
    // Cell 12 is traversed at tick 2. The other agent passes it at tick 2, 1, 3, and 5.
    expect(count([40, 41, 12, 42, 43, 44, 45, 46, 47, 48, 49, 50], 0, 5)).toBe(1)
    expect(count([40, 12, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51], 0, 5)).toBe(1)
    expect(count([40, 41, 42, 12, 43, 44, 45, 46, 47, 48, 49, 50], 0, 5)).toBe(1)
    expect(count([40, 41, 42, 43, 44, 12, 45, 46, 47, 48, 49, 50], 0, 5)).toBe(0)
    // A hold on a path cell counts the hold penalty.
    const held = new ReservationTable(cells, 50)
    held.reserveHold(7, 12, 0)
    expect(held.congestionAlong(path, 0, 10)).toBe(10)
    // Nothing is counted beyond the horizon.
    const short = new ReservationTable(cells, 1)
    short.reservePath(7, [40, 41, 12], 0)
    expect(short.congestionAlong(path, 0, 10)).toBe(0)
  })
})

describe('assignment cost (Eq. 4) and the Hungarian step (Proposition 3)', () => {
  const map = loadLayout('small')
  const ctx: CostContext = { map, oracle: new DistanceOracle(map), battery: DEFAULT_BATTERY, wBattery: 1 }
  const task = { pickup: map.pickups[0], delivery: map.deliveries[0] }
  const from = map.homes[3]

  it('prices a pair at the arrival estimate times 1 + w_b (1 - s)', () => {
    const d = ctx.oracle.dist(from, task.pickup)
    expect(batteryFactor(ctx, 0.6)).toBeCloseTo(1.4, 12)
    expect(staticCost(ctx, from, 0.6, task)).toBeCloseTo(d * 1.4, 12)
    expect(estimatedCost(ctx, from, 0.6, task, d + 3)).toBeCloseTo((d + 3) * 1.4, 12)
    expect(staticCost({ ...ctx, wBattery: 0 }, from, 0.6, task)).toBe(d)
  })

  it('marks a pair infeasible when the charge does not cover pickup, delivery, the nearest slot and the reserve', () => {
    const d1 = ctx.oracle.dist(from, task.pickup)
    const d2 = ctx.oracle.dist(task.pickup, task.delivery)
    const dc = Math.min(...chargerSlots(map).map((s) => ctx.oracle.dist(task.delivery, s)))
    const need = (d1 + d2 + dc) * DEFAULT_BATTERY.drainMove + DEFAULT_BATTERY.reserve
    expect(taskFeasible(ctx, from, need + 1e-9, task)).toBe(true)
    expect(taskFeasible(ctx, from, need - 1e-9, task)).toBe(false)
    expect(staticCost(ctx, from, need - 1e-9, task)).toBe(Number.POSITIVE_INFINITY)
    expect(estimatedCost(ctx, from, 1, task, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
  })

  it('matches as many feasible pairs as possible before it minimises cost', () => {
    const INF = Number.POSITIVE_INFINITY
    // The cheapest single pair (0,0) would leave row 1 unmatched.
    expect(hungarian([[1, 100], [2, INF]])).toEqual([1, 0])
    expect(INFEASIBLE_OFFSET).toBe(1e6)
  })
})

describe('pool admission and endpoint capacities', () => {
  it('never has more robots in flight per dock or per pickup than the capacities allow', () => {
    expect(POOL_FACTOR).toBe(2)
    expect(POOL_MIN).toBe(8)
    for (const dockCapacity of [1, 2, 3]) {
      let maxDock = 0
      let maxPickup = 0
      const { m } = audited({ layout: 'warehouse', fleetSize: 16, numTasks: 60, arrivalRate: Number.POSITIVE_INFINITY, dockCapacity, seed: 3 }, (sim) => {
        const dock = new Map<Cell, number>()
        const pickup = new Map<Cell, number>()
        for (const r of sim.robots) {
          if (!r.task) continue
          dock.set(r.task.delivery, (dock.get(r.task.delivery) ?? 0) + 1)
          if (r.status === 'to_pickup') pickup.set(r.task.pickup, (pickup.get(r.task.pickup) ?? 0) + 1)
        }
        maxDock = Math.max(maxDock, ...dock.values())
        maxPickup = Math.max(maxPickup, ...pickup.values())
      })
      expect(m.tasksCompleted).toBe(60)
      expect(maxDock).toBeLessThanOrEqual(dockCapacity)
      expect(maxDock).toBe(dockCapacity)
      expect(maxPickup).toBeLessThanOrEqual(DEFAULT_CONFIG.pickupCapacity)
    }
  })
})

describe('stall detector', () => {
  it('stops a run after stallLimit ticks without a pickup or delivery while tasks are outstanding', () => {
    const { m, sim } = audited({ layout: 'warehouse', fleetSize: 4, numTasks: 20, arrivalRate: Number.POSITIVE_INFINITY, stallLimit: 3, seed: 1 })
    expect(m.deadlocked).toBe(1)
    expect(m.tasksUnfinished).toBeGreaterThan(0)
    expect(sim.tick).toBe(4)
  })

  it('does not fire while no task is outstanding', () => {
    // One task arrives late in a slow Poisson stream; the idle fleet before it is not a stall.
    const { m } = audited({ layout: 'small', fleetSize: 2, numTasks: 2, arrivalRate: 0.005, stallLimit: 60, seed: 4 })
    expect(m.deadlocked).toBe(0)
    expect(m.tasksCompleted).toBe(2)
    expect(m.makespan).toBeGreaterThan(60)
  })
})

describe('conditional charge proposition (Proposition 2)', () => {
  it('holds on an instance that satisfies its premises: no depletion when the measured W and Q fit the reserve', () => {
    const cfg: Partial<SimConfig> = { layout: 'small', fleetSize: 1, numTasks: 60, arrivalRate: Number.POSITIVE_INFINITY, initialSoc: [0.2, 0.25], seed: 2 }
    const { m, audit, sim } = audited(cfg)
    const b = sim.cfg.battery
    const oracle = new DistanceOracle(sim.map)
    let D = 0
    for (const s of chargerSlots(sim.map)) for (const d of oracle.toGoal(s)) D = Math.max(D, d)
    const W = audit.maxWorkTripDelay
    const Q = audit.maxSlotWait
    // Premises of the proposition, with the delays measured on this run.
    expect(b.drainWait).toBeLessThanOrEqual(b.drainMove)
    expect(b.socLow).toBeGreaterThan(b.drainMove * (1 + W + Q + D))
    expect(b.reserve).toBeGreaterThan(b.drainMove * (3 * W + Q + D) + 2 * b.drainWait * sim.cfg.dwell)
    // Conclusion.
    expect(m.depletionEvents).toBe(0)
    expect(audit.minSoc).toBeGreaterThan(0)
    expect(m.chargeSessions).toBeGreaterThan(0)
    expect(m.tasksCompleted).toBe(60)
  })
})

describe('coupling diagnostics', () => {
  const base: Partial<SimConfig> = { layout: 'warehouse', fleetSize: 16, numTasks: 60, arrivalRate: Number.POSITIVE_INFINITY, seed: 5 }

  it('are zero for the static cost models and consistent for the coupled ones', () => {
    for (const alloc of ['greedy', 'hungarian'] as const) {
      const m = new FleetSimulator({ ...base, alloc }).run()
      expect(m.cplPairs + m.cplAllocs + m.cplPairsDiffer + m.cplAllocsMatchDiffer).toBe(0)
    }
    for (const alloc of ['pact', 'pact-proxy'] as const) {
      const m = new FleetSimulator({ ...base, alloc }).run()
      expect(m.cplPairs).toBeGreaterThan(0)
      expect(m.cplAllocs).toBeGreaterThan(0)
      expect(m.cplPairsDiffer).toBeLessThanOrEqual(m.cplPairs)
      expect(m.cplPairsBeyond).toBeLessThanOrEqual(m.cplPairs)
      expect(m.cplAllocsMatchDiffer).toBeLessThanOrEqual(m.cplAllocsCostDiffer)
      expect(m.cplAllocsCostDiffer).toBeLessThanOrEqual(m.cplAllocs)
      // An estimate is never below the free-space distance.
      expect(m.cplGapSum).toBeGreaterThanOrEqual(m.cplPairsDiffer)
    }
  })

  it('a window that covers no reservation makes the path-aware cost equal to the static one', () => {
    // One robot: no other reservation exists, so the two matrices and matchings agree.
    const m = new FleetSimulator({ ...base, fleetSize: 1, numTasks: 10, alloc: 'pact' }).run()
    expect(m.cplPairs).toBeGreaterThan(0)
    expect(m.cplPairsDiffer).toBe(0)
    expect(m.cplAllocsMatchDiffer).toBe(0)
  })
})

describe('token-passing variants', () => {
  const base: Partial<SimConfig> = { layout: 'warehouse', fleetSize: 12, numTasks: 60, arrivalRate: Number.POSITIVE_INFINITY, seed: 2 }

  for (const tpFree of ['home-interruptible', 'faithful'] as const) {
    for (const coordinator of ['tp', 'tpts'] as const) {
      it(`${coordinator} with tpFree=${tpFree} is conflict-free and completes every task`, () => {
        const { m, audit } = audited({ ...base, coordinator, tpFree })
        expect(audit.vertexConflicts + audit.swapConflicts + audit.illegalMoves + m.conflicts).toBe(0)
        expect(m.deadlocked).toBe(0)
        expect(m.tasksCompleted).toBe(60)
        expect(m.depletionEvents).toBe(0)
      })
    }
  }

  it('faithful: a robot without a task rests where its path ended unless a pending task delivers there', () => {
    let restedOffHome = 0
    audited({ ...base, coordinator: 'tp', tpFree: 'faithful', arrivalRate: 0.05, numTasks: 30 }, (sim) => {
      for (const r of sim.robots) {
        if (r.status !== 'idle' || r.cell === r.home) continue
        restedOffHome += 1
        // Paths end at docks, home bays or charger slots, and a robot leaves a slot at once.
        expect(sim.map.deliveries.includes(r.cell) || sim.map.homes.includes(r.cell)).toBe(true)
      }
    })
    expect(restedOffHome).toBeGreaterThan(0)
  })

  it('a robot interrupted on a pickup cell that takes a task there starts loading at once (warehouse, 32 robots, seed 2)', () => {
    const { m, audit } = audited({ layout: 'warehouse', fleetSize: 32, numTasks: 200, arrivalRate: Number.POSITIVE_INFINITY, coordinator: 'tpts', tpFree: 'home-interruptible', seed: 2 })
    expect(m.deadlocked).toBe(0)
    expect(m.tasksCompleted).toBe(200)
    expect(audit.vertexConflicts + audit.swapConflicts + audit.illegalMoves).toBe(0)
  }, 60000)
})
