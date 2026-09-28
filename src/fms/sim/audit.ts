/**
 * Independent trajectory auditor.
 *
 * The simulator counts conflicts on the step it is about to execute, from the
 * plans it holds. This auditor does not look at plans, reservations or any
 * planner bookkeeping: it is fed the robots' observed cells (and public status
 * fields) after every tick and re-derives, with its own code, every safety and
 * progress quantity reported by the stress sweep:
 *
 *   - vertex conflicts: two robots on one cell at the same tick;
 *   - swap conflicts: two robots exchanging cells in one tick;
 *   - illegal moves: a jump to a non-adjacent cell or onto an obstacle, or a
 *     depleted robot that moves;
 *   - depletions: robots whose observed charge reached 0;
 *   - progress: the longest interval without any pickup or delivery while
 *     tasks were outstanding, and the longest run of consecutive ticks a
 *     robot away from its goal did not move;
 *   - charge margins: minimum observed charge, longest wait of a robot below
 *     the charging threshold for a slot, the most wait ticks on one trip and
 *     the largest trip delay (ticks spent on a trip beyond the free-space
 *     distance it covered), the quantities W and Q of the conditional charge
 *     proposition in the paper.
 *
 * Distances are exact grid BFS distances (DistanceOracle), a property of the
 * map, not of any plan.
 */
import { type Cell, type GridMap, DistanceOracle } from '../map/grid'

/** Statuses during which a robot drives towards its goal. */
const TRIP_STATUS = new Set(['to_pickup', 'to_delivery', 'to_charger', 'parking'])

/** The minimal read-only view of a robot the auditor needs. */
export interface ObservedRobot {
  readonly cell: Cell
  readonly soc: number
  readonly status: string
  readonly goal: Cell
}

/** The minimal read-only view of a running simulation the auditor needs. */
export interface ObservedSim {
  readonly tick: number
  readonly robots: readonly ObservedRobot[]
  /** Pickups plus deliveries so far (monotone). */
  progressCount(): number
  /** Tasks released but not yet delivered. */
  outstandingTasks(): number
}

export interface AuditReport {
  ticks: number
  robotTicks: number
  vertexConflicts: number
  swapConflicts: number
  illegalMoves: number
  depletions: number
  /** Longest run of ticks with tasks outstanding and no pickup or delivery. */
  maxNoProgress: number
  /** Longest run of consecutive ticks one robot away from its goal did not move. */
  maxWaitStreak: number
  /** Most wait ticks spent on a single trip (maximal interval with the same status and goal). */
  maxTripWaits: number
  /**
   * Largest trip delay W: over trips (maximal intervals with the same driving
   * status and goal), elapsed ticks minus the reduction of free-space distance
   * to the goal achieved during the trip.
   */
  maxTripDelay: number
  /** Longest time a robot below the charging threshold spent waiting for a slot. */
  maxSlotWait: number
  /** Minimum observed charge over robots that are not depleted. */
  minSoc: number
}

export class TrajectoryAuditor {
  private readonly map: GridMap
  private readonly oracle: DistanceOracle
  private readonly socLow: number
  private readonly tripStart: Cell[]
  private readonly tripTicks: number[]
  private prev: Cell[]
  private readonly prevStatus: string[]
  private readonly prevGoal: Cell[]
  private readonly streak: number[]
  private readonly tripWaits: number[]
  private readonly slotWait: number[]
  private readonly depleted: boolean[]
  private lastProgress: number
  private lastProgressTick: number
  private readonly r: AuditReport

  constructor(map: GridMap, socLow: number, sim: ObservedSim) {
    this.map = map
    this.oracle = new DistanceOracle(map)
    this.socLow = socLow
    const n = sim.robots.length
    this.prev = sim.robots.map((x) => x.cell)
    this.prevStatus = sim.robots.map((x) => x.status)
    this.prevGoal = sim.robots.map((x) => x.goal)
    this.streak = new Array<number>(n).fill(0)
    this.tripWaits = new Array<number>(n).fill(0)
    this.slotWait = new Array<number>(n).fill(0)
    this.tripStart = sim.robots.map((x) => x.cell)
    this.tripTicks = new Array<number>(n).fill(0)
    this.depleted = sim.robots.map((x) => x.soc <= 0)
    this.lastProgress = sim.progressCount()
    this.lastProgressTick = sim.tick
    this.r = {
      ticks: 0,
      robotTicks: 0,
      vertexConflicts: 0,
      swapConflicts: 0,
      illegalMoves: 0,
      depletions: 0,
      maxNoProgress: 0,
      maxWaitStreak: 0,
      maxTripWaits: 0,
      maxTripDelay: 0,
      maxSlotWait: 0,
      minSoc: Math.min(1, ...sim.robots.map((x) => x.soc)),
    }
    // Distinct starts are part of the contract being audited.
    this.r.vertexConflicts += this.duplicates(this.prev)
  }

  private duplicates(cells: readonly Cell[]): number {
    const seen = new Set<Cell>()
    let n = 0
    for (const c of cells) {
      if (seen.has(c)) n += 1
      else seen.add(c)
    }
    return n
  }

  private adjacent(a: Cell, b: Cell): boolean {
    const w = this.map.width
    const ax = a % w
    const ay = (a - ax) / w
    const bx = b % w
    const by = (b - bx) / w
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1
  }

  /** Call once after every executed tick. */
  observe(sim: ObservedSim): void {
    const robots = sim.robots
    const n = robots.length
    const cur = robots.map((x) => x.cell)
    this.r.ticks += 1
    this.r.robotTicks += n
    // Vertex conflicts.
    this.r.vertexConflicts += this.duplicates(cur)
    // Swap conflicts: i moved a->b and j moved b->a.
    const moveIndex = new Map<string, number>()
    for (let i = 0; i < n; i += 1) {
      if (cur[i] === this.prev[i]) continue
      moveIndex.set(`${this.prev[i]}>${cur[i]}`, i)
    }
    for (let i = 0; i < n; i += 1) {
      if (cur[i] === this.prev[i]) continue
      const j = moveIndex.get(`${cur[i]}>${this.prev[i]}`)
      if (j !== undefined && j > i) this.r.swapConflicts += 1
    }
    for (let i = 0; i < n; i += 1) {
      const moved = cur[i] !== this.prev[i]
      // Illegal moves.
      if (moved && (!this.adjacent(this.prev[i], cur[i]) || this.map.blocked[cur[i]] === 1)) this.r.illegalMoves += 1
      if (moved && this.depleted[i]) this.r.illegalMoves += 1
      // Depletion.
      const soc = robots[i].soc
      if (!this.depleted[i] && soc <= 0) {
        this.depleted[i] = true
        this.r.depletions += 1
      }
      if (!this.depleted[i]) this.r.minSoc = Math.min(this.r.minSoc, soc)
      // Wait streaks: not moving while away from the goal.
      const status = robots[i].status
      const goal = robots[i].goal
      const waiting = !moved && cur[i] !== goal && !this.depleted[i]
      if (waiting) {
        this.streak[i] += 1
        this.r.maxWaitStreak = Math.max(this.r.maxWaitStreak, this.streak[i])
      } else {
        this.streak[i] = 0
      }
      // Trips end when status or goal changes. The status seen now was set after
      // this tick's move, so the move just made belongs to the previous trip.
      if (TRIP_STATUS.has(this.prevStatus[i]) && !this.depleted[i]) {
        this.tripTicks[i] += 1
        const g = this.prevGoal[i]
        const delay = this.tripTicks[i] - (this.oracle.dist(this.tripStart[i], g) - this.oracle.dist(cur[i], g))
        this.r.maxTripDelay = Math.max(this.r.maxTripDelay, delay)
      }
      if (status !== this.prevStatus[i] || goal !== this.prevGoal[i]) {
        this.tripWaits[i] = 0
        this.tripTicks[i] = 0
        this.tripStart[i] = cur[i]
        // From outside it is unknown whether the status changed before this
        // tick's step (epoch assignment) or after it (arrival processing); count
        // the step for the new trip as well, which can only overestimate delays.
        if (TRIP_STATUS.has(status) && !this.depleted[i]) {
          this.tripStart[i] = this.prev[i]
          this.tripTicks[i] = 1
          const delay = 1 - (this.oracle.dist(this.prev[i], goal) - this.oracle.dist(cur[i], goal))
          this.r.maxTripDelay = Math.max(this.r.maxTripDelay, delay)
        }
      }
      if (waiting) {
        this.tripWaits[i] += 1
        this.r.maxTripWaits = Math.max(this.r.maxTripWaits, this.tripWaits[i])
      }
      // Waiting for a charger slot: below threshold, not yet sent to a charger.
      if ((status === 'idle' || status === 'parking') && soc < this.socLow && !this.depleted[i]) {
        this.slotWait[i] += 1
        this.r.maxSlotWait = Math.max(this.r.maxSlotWait, this.slotWait[i])
      } else {
        this.slotWait[i] = 0
      }
      this.prevStatus[i] = status
      this.prevGoal[i] = goal
    }
    // Progress.
    const p = sim.progressCount()
    if (p !== this.lastProgress || sim.outstandingTasks() === 0) {
      this.lastProgress = p
      this.lastProgressTick = sim.tick
    } else {
      this.r.maxNoProgress = Math.max(this.r.maxNoProgress, sim.tick - this.lastProgressTick)
    }
    this.prev = cur
  }

  report(): AuditReport {
    return { ...this.r }
  }
}
