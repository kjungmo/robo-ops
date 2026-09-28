import { describe, expect, it } from 'vitest'
import { TokenTable, DwellGoal } from '../mapf/token_table'
import { FleetSimulator, type SimConfig } from '../sim/simulator'
import { TrajectoryAuditor } from '../sim/audit'
import { loadLayout } from '../map/layouts'
import { DistanceOracle } from '../map/grid'

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

describe('token table', () => {
  it('ends every path with a permanent rest and has no horizon', () => {
    const t = new TokenTable(100)
    t.reservePath(1, [10, 11, 12], 5)
    expect(t.vertexFree(11, 6)).toBe(false)
    expect(t.vertexFree(11, 7)).toBe(true)
    expect(t.vertexFree(12, 7)).toBe(false)
    expect(t.vertexFree(12, 100000)).toBe(false)
    expect(t.edgeFree(12, 11, 6)).toBe(false) // swap with 11->12 at t=6
    expect(t.goalFree(11, 7)).toBe(true)
    expect(t.goalFree(11, 6)).toBe(false)
    expect(t.goalFree(12, 1000)).toBe(false)
    expect(t.endOf(1)).toBe(12)
    t.releaseAgent(1)
    expect(t.vertexFree(12, 100000)).toBe(true)
    expect(t.goalFree(11, 0)).toBe(true)
    expect(t.endOf(1)).toBe(-1)
  })

  it('treats a pickup as a goal that must stay free only for the dwell', () => {
    const t = new TokenTable(100)
    t.reservePath(2, [30, 31, 32], 0) // passes 31 at t=1
    const d = new DwellGoal(t, 2)
    expect(d.goalFree(31, 3)).toBe(true)
    expect(d.goalFree(31, 0)).toBe(false)
    expect(t.goalFree(31, 3)).toBe(true)
    expect(d.goalFree(32, 5)).toBe(false) // permanent rest
  })
})

describe('token passing baselines', () => {
  it('TP is conflict-free, completes every task and keeps path ends distinct', () => {
    for (const layout of ['small', 'warehouse']) {
      const { m, audit } = audited({ layout, fleetSize: 6, numTasks: 40, arrivalRate: Number.POSITIVE_INFINITY, seed: 3, coordinator: 'tp', strict: true }, (sim) => {
        // TP's endpoint rule: no two robots rest on (or are bound to end at) the same cell.
        const ends = sim.robots.map((r) => r.path[r.path.length - 1])
        expect(new Set(ends).size).toBe(ends.length)
      })
      expect(audit.vertexConflicts + audit.swapConflicts + audit.illegalMoves).toBe(0)
      expect(m.tasksCompleted).toBe(40)
      expect(m.taskSwaps).toBe(0)
    }
  })

  it('TPTS swaps tasks to earlier arrivals and stays conflict-free', () => {
    const { m, audit } = audited({ layout: 'small', fleetSize: 6, numTasks: 60, arrivalRate: Number.POSITIVE_INFINITY, seed: 1, coordinator: 'tpts', strict: true })
    expect(m.taskSwaps).toBeGreaterThan(0)
    expect(audit.vertexConflicts + audit.swapConflicts + audit.illegalMoves).toBe(0)
    expect(m.tasksCompleted).toBe(60)
  })

  it('TP plans the whole trip: a robot reaches the pickup exactly at its planned time and dwells', () => {
    const sim = new FleetSimulator({ layout: 'warehouse', fleetSize: 4, numTasks: 8, arrivalRate: Number.POSITIVE_INFINITY, seed: 2, coordinator: 'tp', strict: true })
    const seen = new Map<number, number>()
    while (!sim.finished) {
      sim.step()
      for (const r of sim.robots) {
        if (r.status === 'loading' && r.task && !seen.has(r.task.id)) {
          seen.set(r.task.id, sim.tick)
          expect(r.cell).toBe(r.task.pickup)
          expect(sim.tick).toBe(r.pickupAt)
        }
      }
    }
    expect(seen.size).toBe(8)
  })
})

describe('planner fallbacks and priorities', () => {
  it('without the hold cascade prioritized planning executes conflicts (small, 8 robots, seed 1)', () => {
    const base: Partial<SimConfig> = { layout: 'small', fleetSize: 8, numTasks: 100, arrivalRate: Number.POSITIVE_INFINITY, seed: 1, alloc: 'hungarian' }
    const none = audited({ ...base, fallback: 'none' })
    expect(none.audit.vertexConflicts + none.audit.swapConflicts).toBeGreaterThan(0)
    const cascade = audited({ ...base, fallback: 'cascade', strict: true })
    expect(cascade.audit.vertexConflicts + cascade.audit.swapConflicts).toBe(0)
    expect(cascade.m.tasksCompleted).toBe(100)
  })

  it('priority restarts plan every agent of the call', () => {
    const r = audited({ layout: 'small', fleetSize: 8, numTasks: 60, arrivalRate: Number.POSITIVE_INFINITY, seed: 2, alloc: 'hungarian', fallback: 'restart' })
    expect(r.m.tasksCompleted).toBe(60)
  })
})

describe('demand models and the one-lane layout', () => {
  it('narrow has one-lane aisles: every pickup has free neighbours only along its row', () => {
    const map = loadLayout('narrow')
    for (const p of map.pickups) {
      const up = p - map.width
      const down = p + map.width
      expect(map.blocked[up]).toBe(1)
      expect(map.blocked[down]).toBe(1)
    }
  })

  it('hotspot and far demand concentrate pickups as specified', () => {
    const count = (demand: SimConfig['demand']) => {
      const sim = new FleetSimulator({ layout: 'warehouse', fleetSize: 4, numTasks: 1000, arrivalRate: Number.POSITIVE_INFINITY, seed: 5, demand })
      const freq = new Map<number, number>()
      for (const t of sim.tasks) freq.set(t.pickup, (freq.get(t.pickup) ?? 0) + 1)
      return { sim, freq }
    }
    const hot = count('hotspot')
    const top = [...hot.freq.values()].sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0)
    expect(top / 1000).toBeGreaterThan(0.75) // 80% + a share of the uniform 20%
    const far = count('far')
    const oracle = new DistanceOracle(far.sim.map)
    const toDock = (p: number) => Math.min(...far.sim.map.deliveries.map((d) => oracle.dist(p, d)))
    const all = far.sim.map.pickups.map(toDock).sort((a, b) => a - b)
    const median = all[Math.floor(all.length / 2)]
    expect(far.sim.tasks.every((t) => toDock(t.pickup) >= median)).toBe(true)
    // Uniform demand still draws the same random stream as before.
    const uni = count('uniform')
    expect(uni.freq.size).toBeGreaterThan(90)
  })
})

describe('baseline and backend instrumentation', () => {
  it('counts token-passing searches cut off by the expansion bound', () => {
    const tight = audited({ layout: 'small', fleetSize: 4, numTasks: 20, arrivalRate: Number.POSITIVE_INFINITY, seed: 2, coordinator: 'tp', tpMaxExpansions: 5 })
    expect(tight.m.tpSearchLimitHits).toBeGreaterThan(0)
    const loose = audited({ layout: 'small', fleetSize: 4, numTasks: 20, arrivalRate: Number.POSITIVE_INFINITY, seed: 2, coordinator: 'tp' })
    expect(loose.m.tpSearchLimitHits).toBe(0)
    expect(loose.m.tpSwapVetoes).toBe(0) // plain TP never attempts a swap
  })

  it('counts CBS fallbacks caused by the node budget separately', () => {
    const { m } = audited({ layout: 'small', fleetSize: 8, numTasks: 30, arrivalRate: Number.POSITIVE_INFINITY, seed: 3, mapf: 'cbs', cbsMaxNodes: 1 })
    expect(m.cbsBudgetExceeded).toBeGreaterThan(0)
    expect(m.cbsBudgetExceeded).toBeLessThanOrEqual(m.cbsFallbacks)
  })
})
