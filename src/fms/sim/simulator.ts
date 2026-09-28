/**
 * Discrete-time lifelong fleet simulator (allocation + MAPF + charging).
 *
 * Every tick: (1) new tasks arrive from a seeded Poisson stream; (2) at the
 * start of each replanning epoch (every `period` ticks, or immediately when a
 * robot became idle while tasks are pending, or after a depletion) the fleet
 * is re-planned over a rolling window of `window` ticks: busy robots first,
 * then charger assignment, then task allocation, then the newly assigned and
 * parking robots; (3) every robot executes one action of its current plan and
 * the executed step is checked for vertex and swap conflicts; (4) robots that
 * reached a goal transition (pickup -> delivery, delivery -> idle, charger ->
 * charging, home -> idle) and get an immediate single-agent re-plan against
 * the live reservation table.
 *
 * Allocation methods:
 *   greedy      - cheapest-pair-first on static distances
 *   hungarian   - optimal assignment on static distances
 *   pact-proxy  - Hungarian on static distance + congestion counted from the
 *                 reservation table along the shortest path
 *   pact        - Hungarian on arrival times returned by windowed space-time
 *                 A* against the reservation table (MAPF-in-the-loop)
 */
import { Rng } from '../core/rng'
import { type Cell, type GridMap, DistanceOracle, cellX, cellY, chargerSlots } from '../map/grid'
import { loadLayout } from '../map/layouts'
import { hungarian } from '../alloc/hungarian'
import { greedyAssign } from '../alloc/greedy'
import { type CostContext, staticCost, estimatedCost } from '../alloc/cost'
import { ReservationTable } from '../mapf/constraints'
import { spaceTimeAStar } from '../mapf/spacetime_astar'
import { prioritizedPlan, type PPAgent } from '../mapf/prioritized'
import { cbs } from '../mapf/cbs'
import { stepConflicts } from '../mapf/conflicts'
import {
  type BatteryModel,
  DEFAULT_BATTERY,
  applyCharge,
  applyMove,
  applyWait,
  chargingDone,
  needsCharge,
} from '../charging/policy'
import type { SimMetrics } from './metrics'

export type AllocMethod = 'greedy' | 'hungarian' | 'pact-proxy' | 'pact'
export type MapfMethod = 'pp' | 'cbs'
export type RobotStatus =
  | 'idle'
  | 'to_pickup'
  | 'loading'
  | 'to_delivery'
  | 'unloading'
  | 'to_charger'
  | 'charging'
  | 'parking'
  | 'depleted'

export interface SimConfig {
  layout: string
  fleetSize: number
  numTasks: number
  /** Mean task arrivals per tick (Poisson); Infinity releases all tasks at t=0. */
  arrivalRate: number
  seed: number
  alloc: AllocMethod
  mapf: MapfMethod
  /** Planning window w (ticks). */
  window: number
  /** Replanning period h (ticks), h <= window. */
  period: number
  /** Nearest candidate tasks priced per robot. */
  candidateK: number
  battery: BatteryModel
  initialSoc: [number, number]
  maxTicks: number
  wBattery: number
  congestionWeight: number
  holdPenalty: number
  cbsMaxNodes: number
  /** Trigger an epoch as soon as a robot goes idle with tasks pending. */
  eventReplan: boolean
  /** Ticks spent loading at the pickup and unloading at the dock. */
  dwell: number
  /** Max robots in flight (assigned, not yet delivered) per delivery dock. */
  dockCapacity: number
  /** Max robots in flight per pickup endpoint. */
  pickupCapacity: number
  /** Declare a deadlock after this many ticks without any task progress. */
  stallLimit: number
  /** Throw on internal invariant violations (tests). */
  strict: boolean
}

export const DEFAULT_CONFIG: SimConfig = {
  layout: 'warehouse',
  fleetSize: 16,
  numTasks: 200,
  arrivalRate: 0.5,
  seed: 1,
  alloc: 'hungarian',
  mapf: 'pp',
  window: 20,
  period: 5,
  candidateK: 6,
  battery: DEFAULT_BATTERY,
  initialSoc: [0.5, 1.0],
  maxTicks: 20000,
  wBattery: 1.0,
  congestionWeight: 1.0,
  holdPenalty: 10,
  cbsMaxNodes: 2000,
  eventReplan: true,
  dwell: 2,
  dockCapacity: 3,
  pickupCapacity: 1,
  stallLimit: 1000,
  strict: false,
}

export interface Task {
  id: number
  name: string
  pickup: Cell
  delivery: Cell
  arrival: number
  assigned: number
  pickedUp: number
  completed: number
  robot: number
  reassignments: number
}

export interface Robot {
  id: number
  name: string
  cell: Cell
  soc: number
  status: RobotStatus
  home: Cell
  task: Task | null
  goal: Cell
  path: Cell[]
  pathStart: number
  slot: Cell | null
  dwellUntil: number
  heldLast: boolean
  moves: number
  waits: number
  busyTicks: number
  tasksDone: number
}

export interface RobotSnapshot {
  id: number
  name: string
  x: number
  y: number
  soc: number
  status: RobotStatus
  task: string | null
  goalX: number
  goalY: number
  path: Array<[number, number]>
}

export interface SimSnapshot {
  tick: number
  finished: boolean
  robots: RobotSnapshot[]
  pendingTasks: number
  activeTasks: number
  completedTasks: number
  totalTasks: number
  conflicts: number
  depletionEvents: number
  chargingRobots: number
  movingRobots: number
  idleRobots: number
}

const STATUS_RANK: Record<RobotStatus, number> = {
  to_delivery: 0,
  to_pickup: 1,
  to_charger: 2,
  parking: 3,
  idle: 4,
  loading: 5,
  unloading: 5,
  charging: 6,
  depleted: 7,
}

const STATIC_STATUS = new Set<RobotStatus>(['idle', 'loading', 'unloading', 'charging', 'depleted'])

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export class FleetSimulator {
  readonly cfg: SimConfig
  readonly map: GridMap
  readonly oracle: DistanceOracle
  readonly rng: Rng
  readonly robots: Robot[] = []
  readonly tasks: Task[] = []
  /** Unassigned tasks in arrival order. */
  readonly pending: Task[] = []
  tick = 0
  finishedAt: number | null = null

  private table: ReservationTable
  private forceReplan = true
  private lastEpochTick = -1
  private lastProgressTick = 0
  deadlocked = false
  private tasksGenerated = 0
  private completedCount = 0
  private readonly slotReserved = new Map<Cell, number>()
  private readonly costCtx: CostContext
  private readonly acc = {
    conflicts: 0,
    depletion: 0,
    chargeSessions: 0,
    holds: 0,
    cbsFallbacks: 0,
    epochs: 0,
    astarCalls: 0,
    expansions: 0,
    plannerMs: 0,
    allocMs: 0,
    moves: 0,
    waits: 0,
    busyTicks: 0,
  }

  constructor(config: Partial<SimConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config, battery: { ...DEFAULT_BATTERY, ...(config.battery ?? {}) } }
    if (this.cfg.period > this.cfg.window) throw new Error('period must be <= window')
    this.map = loadLayout(this.cfg.layout)
    this.oracle = new DistanceOracle(this.map)
    this.rng = new Rng(this.cfg.seed)
    if (this.cfg.fleetSize > this.map.homes.length) {
      throw new Error(`layout ${this.map.name} has ${this.map.homes.length} home bays, fleet of ${this.cfg.fleetSize} requested`)
    }
    for (let i = 0; i < this.cfg.fleetSize; i += 1) {
      const home = this.map.homes[i]
      this.robots.push({
        id: i,
        name: `AMR-${String(i + 1).padStart(3, '0')}`,
        cell: home,
        soc: 1,
        status: 'idle',
        home,
        task: null,
        goal: home,
        path: [home],
        pathStart: 0,
        slot: null,
        dwellUntil: 0,
        heldLast: false,
        moves: 0,
        waits: 0,
        busyTicks: 0,
        tasksDone: 0,
      })
    }
    for (const r of this.robots) r.soc = this.rng.range(this.cfg.initialSoc[0], this.cfg.initialSoc[1])
    this.costCtx = { map: this.map, oracle: this.oracle, battery: this.cfg.battery, wBattery: this.cfg.wBattery }
    this.table = new ReservationTable(this.map.width * this.map.height, this.cfg.window)
    if (this.cfg.arrivalRate === Number.POSITIVE_INFINITY) this.generateTasks(this.cfg.numTasks)
  }

  get finished(): boolean {
    return this.finishedAt !== null
  }

  get completedTasks(): number {
    return this.completedCount
  }

  // ---------------------------------------------------------------- stepping

  step(): void {
    if (this.finished) return
    this.generateArrivals()
    if (this.tick % this.cfg.period === 0 || this.forceReplan) {
      this.epoch()
      this.forceReplan = false
    }
    this.execute()
    this.tick += 1
    this.processArrivals()
    if (this.completedCount >= this.cfg.numTasks) this.finishedAt = this.tick
    else if (this.tick >= this.cfg.maxTicks) this.finishedAt = this.tick
    else if (this.tick - this.lastProgressTick > this.cfg.stallLimit && this.tasksGenerated > this.completedCount) {
      this.deadlocked = true
      this.finishedAt = this.tick
    }
  }

  run(): SimMetrics {
    while (!this.finished) this.step()
    return this.metrics()
  }

  // ---------------------------------------------------------------- arrivals

  private generateTasks(n: number): void {
    for (let i = 0; i < n; i += 1) {
      const id = this.tasks.length
      const task: Task = {
        id,
        name: `MSN-${String(id + 1).padStart(5, '0')}`,
        pickup: this.rng.pick(this.map.pickups),
        delivery: this.rng.pick(this.map.deliveries),
        arrival: this.tick,
        assigned: -1,
        pickedUp: -1,
        completed: -1,
        robot: -1,
        reassignments: 0,
      }
      this.tasks.push(task)
      this.pending.push(task)
      this.tasksGenerated += 1
    }
  }

  private generateArrivals(): void {
    const remaining = this.cfg.numTasks - this.tasksGenerated
    if (remaining <= 0 || this.cfg.arrivalRate === Number.POSITIVE_INFINITY) return
    const k = Math.min(remaining, this.rng.poisson(this.cfg.arrivalRate))
    if (k > 0) this.generateTasks(k)
  }

  // ---------------------------------------------------------------- epochs

  private epoch(): void {
    const t = this.tick
    const t0 = now()
    this.lastEpochTick = t
    this.acc.epochs += 1
    const horizon = t + this.cfg.window
    const table = new ReservationTable(this.map.width * this.map.height, horizon)
    this.table = table

    // (a) Transitions: charging finished; slot release; idle robots off-home park.
    for (const r of this.robots) {
      if (r.status === 'charging' && chargingDone(r.soc, this.cfg.battery)) {
        r.status = 'idle'
        r.goal = r.cell
      }
      if (r.slot !== null && r.status !== 'to_charger' && r.status !== 'charging' && r.cell !== r.slot) {
        this.slotReserved.delete(r.slot)
        r.slot = null
      }
      if (r.status === 'idle' && r.cell !== r.home) {
        r.status = 'parking'
        r.goal = r.home
      }
    }
    // (b) Static holds: depleted, charging, loading/unloading, idle at home.
    for (const r of this.robots) {
      if (STATIC_STATUS.has(r.status)) table.reserveHold(r.id, r.cell, t)
    }
    // (c) Charger assignment for robots that must charge (static costs).
    this.assignChargers(table)
    // (d) Plan busy robots plus parking robots that either block a busy robot's
    // goal or failed to plan last epoch (dynamic priority: a held robot goes first
    // so that a robot boxed in on a dock's access cell can be evacuated).
    const busy = this.robots.filter((r) => r.status === 'to_pickup' || r.status === 'to_delivery' || r.status === 'to_charger')
    const busyGoals = new Set(busy.map((r) => r.goal))
    const blockers = this.robots.filter((r) => r.status === 'parking' && (busyGoals.has(r.cell) || r.heldLast))
    const group1 = this.sortByPriority([...busy, ...blockers])
    this.planGroup(group1, table, t, [])
    // (e) Task allocation for eligible robots.
    const blockerIds = new Set(blockers.map((r) => r.id))
    const eligible = this.robots.filter(
      (r) => (r.status === 'idle' || r.status === 'parking') && !blockerIds.has(r.id) && !needsCharge(r.soc, this.cfg.battery),
    )
    for (const r of eligible) table.releaseAgent(r.id)
    const a0 = now()
    this.allocate(eligible, table)
    this.acc.allocMs += now() - a0
    // (f) Unassigned eligible robots park (a robot already at home gets a trivial
    // plan through the planner so that its rest is consistent with paths
    // reserved earlier in this epoch; it becomes idle on arrival).
    for (const r of eligible) {
      if (r.status === 'to_pickup') continue
      r.status = 'parking'
      r.goal = r.home
    }
    // (g) Plan the remaining movers.
    const group2 = this.sortByPriority(
      this.robots.filter((r) => (r.status === 'to_pickup' || r.status === 'parking') && !group1.includes(r)),
    )
    this.planGroup(group2, table, t, group1)
    // Static robots keep a trivial plan.
    for (const r of this.robots) {
      if (STATIC_STATUS.has(r.status)) {
        r.path = [r.cell]
        r.pathStart = t
      }
    }
    this.acc.plannerMs += now() - t0
  }

  private sortByPriority(list: Robot[]): Robot[] {
    const goals = new Map<Cell, number>()
    for (const r of list) goals.set(r.goal, (goals.get(r.goal) ?? 0) + 1)
    const blocking = (r: Robot) => (r.goal !== r.cell && goals.has(r.cell) ? 1 : 0)
    return [...list].sort((a, b) => {
      const ba = blocking(a)
      const bb = blocking(b)
      if (ba !== bb) return bb - ba
      if (a.heldLast !== b.heldLast) return a.heldLast ? -1 : 1
      const ra = STATUS_RANK[a.status]
      const rb = STATUS_RANK[b.status]
      if (ra !== rb) return ra - rb
      return a.id - b.id
    })
  }

  /**
   * Plan `list` into `table`. `external` are robots planned earlier into the
   * same table this epoch; the hold cascade may re-plan them.
   */
  private planGroup(list: Robot[], table: ReservationTable, t: number, external: Robot[]): void {
    if (list.length === 0) return
    const agents: PPAgent[] = list.map((r) => ({ id: r.id, start: r.cell, goal: r.goal }))
    const externalAgents: PPAgent[] = external.map((r) => ({ id: r.id, start: r.cell, goal: r.goal }))
    const paths = new Map<number, Cell[]>()
    const held = new Set<number>()
    let remaining: PPAgent[] = agents
    if (this.cfg.mapf === 'cbs') {
      // Agents that share a goal are not a valid one-shot MAPF instance (only one
      // can rest there); keep the highest-priority one in CBS and defer the rest.
      const seenGoals = new Set<Cell>()
      const deferred: PPAgent[] = []
      const cbsAgents: PPAgent[] = []
      for (const a of agents) {
        if (seenGoals.has(a.goal)) deferred.push(a)
        else {
          seenGoals.add(a.goal)
          cbsAgents.push(a)
        }
      }
      let res = cbs(this.map, this.oracle, cbsAgents, table, t, table.horizon, { maxNodes: this.cfg.cbsMaxNodes })
      this.acc.astarCalls += res.astarCalls
      this.acc.expansions += res.expansions
      remaining = cbsAgents
      if (res.status === 'infeasible') {
        // Hold the blocked agents through prioritized planning (with cascade), then retry.
        const blocked = new Set(res.infeasible)
        const pp = prioritizedPlan(this.map, this.oracle, cbsAgents.filter((a) => blocked.has(a.id)), table, t, externalAgents)
        for (const [id, p] of pp.paths) paths.set(id, p)
        for (const id of pp.held) held.add(id)
        this.acc.holds += pp.held.size
        this.acc.astarCalls += pp.astarCalls
        this.acc.expansions += pp.expansions
        remaining = cbsAgents.filter((a) => !blocked.has(a.id))
        res = cbs(this.map, this.oracle, remaining, table, t, table.horizon, { maxNodes: this.cfg.cbsMaxNodes })
        this.acc.astarCalls += res.astarCalls
        this.acc.expansions += res.expansions
      }
      if (res.status === 'ok') {
        for (const a of remaining) {
          const p = res.paths.get(a.id) as Cell[]
          paths.set(a.id, p)
          table.reservePath(a.id, p, t)
        }
        remaining = deferred
      } else {
        this.acc.cbsFallbacks += 1
        remaining = [...remaining, ...deferred]
      }
    }
    if (remaining.length > 0) {
      const res = prioritizedPlan(this.map, this.oracle, remaining, table, t, externalAgents)
      for (const [id, p] of res.paths) paths.set(id, p)
      for (const id of res.held) held.add(id)
      this.acc.holds += res.held.size
      this.acc.astarCalls += res.astarCalls
      this.acc.expansions += res.expansions
    }
    for (const r of [...list, ...external]) {
      const p = paths.get(r.id)
      if (!p) continue
      r.path = p
      r.pathStart = t
      r.heldLast = held.has(r.id)
    }
  }

  private assignChargers(table: ReservationTable): void {
    const needing = this.robots.filter((r) => (r.status === 'idle' || r.status === 'parking') && needsCharge(r.soc, this.cfg.battery))
    if (needing.length === 0) return
    const occupied = new Set(this.robots.map((r) => r.cell))
    const free = chargerSlots(this.map).filter((s) => !this.slotReserved.has(s) && !occupied.has(s))
    if (free.length === 0) return
    const cost = needing.map((r) => free.map((s) => this.oracle.dist(r.cell, s)))
    const assignment = this.cfg.alloc === 'greedy' ? greedyAssign(cost) : hungarian(cost)
    needing.forEach((r, i) => {
      const j = assignment[i]
      if (j < 0) return
      const slot = free[j]
      table.releaseAgent(r.id)
      r.status = 'to_charger'
      r.goal = slot
      r.slot = slot
      this.slotReserved.set(slot, r.id)
    })
  }

  private allocate(eligible: Robot[], table: ReservationTable): void {
    if (eligible.length === 0 || this.pending.length === 0) return
    // Endpoint reservation (cf. token passing, Ma et al. 2017): a task enters the
    // candidate pool only while its pickup and dock have spare in-flight capacity.
    const inflight = new Map<Cell, number>()
    for (const r of this.robots) {
      if (!r.task) continue
      inflight.set(r.task.delivery, (inflight.get(r.task.delivery) ?? 0) + 1)
      if (r.status === 'to_pickup') inflight.set(r.task.pickup, (inflight.get(r.task.pickup) ?? 0) + 1)
    }
    const poolSize = Math.min(this.pending.length, Math.max(2 * eligible.length, 8))
    const pool: Task[] = []
    for (const task of this.pending) {
      if (pool.length >= poolSize) break
      const d = inflight.get(task.delivery) ?? 0
      const pk = inflight.get(task.pickup) ?? 0
      if (d >= this.cfg.dockCapacity || pk >= this.cfg.pickupCapacity) continue
      pool.push(task)
      inflight.set(task.delivery, d + 1)
      inflight.set(task.pickup, pk + 1)
    }
    if (pool.length === 0) return
    const K = this.cfg.candidateK
    const cost: number[][] = []
    for (const r of eligible) {
      const row = new Array<number>(pool.length).fill(Number.POSITIVE_INFINITY)
      // Candidate pruning: K nearest tasks by static distance.
      const order = pool
        .map((task, j) => ({ j, d: this.oracle.dist(r.cell, task.pickup) }))
        .filter((e) => Number.isFinite(e.d))
        .sort((a, b) => a.d - b.d || a.j - b.j)
        .slice(0, K)
      for (const { j } of order) {
        const task = pool[j]
        switch (this.cfg.alloc) {
          case 'greedy':
          case 'hungarian':
            row[j] = staticCost(this.costCtx, r.cell, r.soc, task)
            break
          case 'pact-proxy': {
            const sp = this.oracle.shortestPath(r.cell, task.pickup)
            const congestion = sp ? table.congestionAlong(sp, this.tick, this.cfg.holdPenalty) : Number.POSITIVE_INFINITY
            const d = this.oracle.dist(r.cell, task.pickup)
            row[j] = estimatedCost(this.costCtx, r.cell, r.soc, task, d + this.cfg.congestionWeight * congestion)
            break
          }
          case 'pact': {
            this.acc.astarCalls += 1
            const res = spaceTimeAStar(this.map, this.oracle, r.cell, task.pickup, table, this.tick)
            if (res) this.acc.expansions += res.expansions
            row[j] = estimatedCost(this.costCtx, r.cell, r.soc, task, res ? res.cost : Number.POSITIVE_INFINITY)
            break
          }
        }
      }
      cost.push(row)
    }
    const assignment = this.cfg.alloc === 'greedy' ? greedyAssign(cost) : hungarian(cost)
    const taken = new Set<number>()
    eligible.forEach((r, i) => {
      const j = assignment[i]
      if (j < 0) return
      const task = pool[j]
      taken.add(task.id)
      if (task.assigned < 0) task.assigned = this.tick
      task.robot = r.id
      r.task = task
      r.status = 'to_pickup'
      r.goal = task.pickup
    })
    if (taken.size > 0) {
      let w = 0
      for (let i = 0; i < this.pending.length; i += 1) {
        if (!taken.has(this.pending[i].id)) this.pending[w++] = this.pending[i]
      }
      this.pending.length = w
    }
  }

  // ---------------------------------------------------------------- execution

  private execute(): void {
    const prev = this.robots.map((r) => r.cell)
    const next = this.robots.map((r) => {
      if (r.status === 'depleted') return r.cell
      const k = this.tick - r.pathStart
      if (this.cfg.strict && r.path[Math.min(k, r.path.length - 1)] !== r.cell) {
        throw new Error(`robot ${r.name} off its plan at tick ${this.tick}`)
      }
      return r.path[Math.min(k + 1, r.path.length - 1)]
    })
    const conflicts = stepConflicts(prev, next)
    if (conflicts > 0) {
      this.acc.conflicts += conflicts
      if (this.cfg.strict) {
        const details = this.robots
          .filter((_, i) => this.robots.some((_o, j) => j !== i && (next[j] === next[i] || (next[j] === prev[i] && next[i] === prev[j] && prev[i] !== next[i]))))
          .map((r) => `${r.name} ${r.status} cell=${r.cell} goal=${r.goal} start=${r.pathStart} k=${this.tick - r.pathStart} path=[${r.path.join(',')}] held=${r.heldLast}`)
        throw new Error(`${conflicts} conflict(s) at tick ${this.tick} (last epoch ${this.lastEpochTick}):\n${details.join('\n')}`)
      }
    }
    this.robots.forEach((r, i) => {
      const moved = next[i] !== prev[i]
      r.cell = next[i]
      if (r.status === 'depleted') return
      if (moved) {
        r.moves += 1
        this.acc.moves += 1
        r.soc = applyMove(r.soc, this.cfg.battery)
      } else if (r.status === 'charging') {
        r.soc = applyCharge(r.soc, this.cfg.battery)
      } else {
        if (r.goal !== r.cell) {
          r.waits += 1
          this.acc.waits += 1
        }
        r.soc = applyWait(r.soc, this.cfg.battery)
      }
      if (r.task) {
        r.busyTicks += 1
        this.acc.busyTicks += 1
      }
      if (r.soc <= 0) this.deplete(r)
    })
  }

  private deplete(r: Robot): void {
    this.acc.depletion += 1
    if (r.task) {
      const task = r.task
      task.robot = -1
      task.reassignments += 1
      r.task = null
      this.pending.push(task)
      this.pending.sort((a, b) => a.arrival - b.arrival || a.id - b.id)
    }
    if (r.slot !== null) {
      this.slotReserved.delete(r.slot)
      r.slot = null
    }
    r.status = 'depleted'
    r.goal = r.cell
    this.forceReplan = true
  }

  private startDelivery(r: Robot): void {
    const task = r.task as Task
    task.pickedUp = this.tick
    this.lastProgressTick = this.tick
    r.status = 'to_delivery'
    r.goal = task.delivery
    this.replanOne(r)
  }

  private completeTask(r: Robot): void {
    const task = r.task as Task
    task.completed = this.tick
    this.lastProgressTick = this.tick
    this.completedCount += 1
    r.tasksDone += 1
    r.task = null
    r.status = 'idle'
    r.goal = r.cell
    if (this.cfg.eventReplan && this.pending.length > 0) this.forceReplan = true
  }

  private processArrivals(): void {
    for (const r of this.robots) {
      if (r.status === 'depleted' || r.cell !== r.goal) continue
      // A plan may pass through the goal before its final arrival (when the goal
      // is temporarily held by another robot); arrival means the plan has ended.
      if (this.tick - r.pathStart < r.path.length - 1) continue
      switch (r.status) {
        case 'to_pickup':
          if (this.cfg.dwell > 0) {
            r.status = 'loading'
            r.dwellUntil = this.tick + this.cfg.dwell
          } else {
            this.startDelivery(r)
          }
          break
        case 'loading':
          if (this.tick >= r.dwellUntil) this.startDelivery(r)
          break
        case 'to_delivery':
          if (this.cfg.dwell > 0) {
            r.status = 'unloading'
            r.dwellUntil = this.tick + this.cfg.dwell
          } else {
            this.completeTask(r)
          }
          break
        case 'unloading':
          if (this.tick >= r.dwellUntil) this.completeTask(r)
          break
        case 'to_charger':
          r.status = 'charging'
          this.acc.chargeSessions += 1
          break
        case 'parking':
          r.status = 'idle'
          break
        default:
          break
      }
    }
  }

  /** Re-plan one robot mid-epoch against the live reservation table. */
  private replanOne(r: Robot): void {
    const t0 = now()
    const table = this.table
    table.releaseAgent(r.id)
    this.acc.astarCalls += 1
    const res = spaceTimeAStar(this.map, this.oracle, r.cell, r.goal, table, this.tick)
    if (res) {
      this.acc.expansions += res.expansions
      r.path = res.path
      r.heldLast = false
    } else {
      r.path = [r.cell]
      r.heldLast = true
      this.acc.holds += 1
    }
    r.pathStart = this.tick
    table.reservePath(r.id, r.path, this.tick)
    this.acc.plannerMs += now() - t0
  }

  // ---------------------------------------------------------------- reporting

  metrics(): SimMetrics {
    const done = this.tasks.filter((t) => t.completed >= 0)
    const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
    const makespan = this.finishedAt ?? this.tick
    const service = done.map((t) => t.completed - t.arrival)
    const wait = done.map((t) => t.assigned - t.arrival)
    const exec = done.map((t) => t.completed - t.assigned)
    const ticks = Math.max(1, this.tick)
    return {
      layout: this.cfg.layout,
      fleetSize: this.cfg.fleetSize,
      numTasks: this.cfg.numTasks,
      arrivalRate: this.cfg.arrivalRate,
      seed: this.cfg.seed,
      alloc: this.cfg.alloc,
      mapf: this.cfg.mapf,
      window: this.cfg.window,
      period: this.cfg.period,
      wBattery: this.cfg.wBattery,
      makespan,
      tasksCompleted: done.length,
      tasksUnfinished: this.cfg.numTasks - done.length,
      deadlocked: this.deadlocked ? 1 : 0,
      throughput: (100 * done.length) / Math.max(1, makespan),
      meanServiceTime: mean(service),
      meanWaitTime: mean(wait),
      meanExecTime: mean(exec),
      sumOfCosts: exec.reduce((a, b) => a + b, 0),
      moveActions: this.acc.moves,
      waitActions: this.acc.waits,
      conflicts: this.acc.conflicts,
      depletionEvents: this.acc.depletion,
      chargeSessions: this.acc.chargeSessions,
      holdEvents: this.acc.holds,
      cbsFallbacks: this.acc.cbsFallbacks,
      epochs: this.acc.epochs,
      astarCalls: this.acc.astarCalls,
      expansions: this.acc.expansions,
      plannerMs: this.acc.plannerMs,
      allocMs: this.acc.allocMs,
      plannerMsPerTick: this.acc.plannerMs / ticks,
      utilization: this.acc.busyTicks / (ticks * this.robots.length),
      finalMeanSoc: mean(this.robots.map((r) => r.soc)),
    }
  }

  snapshot(): SimSnapshot {
    const robots = this.robots.map((r) => {
      const k = Math.max(0, this.tick - r.pathStart)
      const rest = r.path.slice(Math.min(k, r.path.length - 1))
      return {
        id: r.id,
        name: r.name,
        x: cellX(this.map, r.cell),
        y: cellY(this.map, r.cell),
        soc: r.soc,
        status: r.status,
        task: r.task ? r.task.name : null,
        goalX: cellX(this.map, r.goal),
        goalY: cellY(this.map, r.goal),
        path: rest.map((c) => [cellX(this.map, c), cellY(this.map, c)] as [number, number]),
      }
    })
    const active = this.robots.filter((r) => r.task !== null).length
    return {
      tick: this.tick,
      finished: this.finished,
      robots,
      pendingTasks: this.pending.length,
      activeTasks: active,
      completedTasks: this.completedCount,
      totalTasks: this.cfg.numTasks,
      conflicts: this.acc.conflicts,
      depletionEvents: this.acc.depletion,
      chargingRobots: this.robots.filter((r) => r.status === 'charging' || r.status === 'to_charger').length,
      movingRobots: this.robots.filter((r) => r.status === 'to_pickup' || r.status === 'to_delivery' || r.status === 'parking').length,
      idleRobots: this.robots.filter((r) => r.status === 'idle').length,
    }
  }
}

export function runSimulation(config: Partial<SimConfig>): SimMetrics {
  return new FleetSimulator(config).run()
}
