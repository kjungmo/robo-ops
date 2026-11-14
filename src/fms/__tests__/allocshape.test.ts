import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FleetSimulator, type SimConfig } from '../sim/simulator'
import { greedyAssign } from '../alloc/greedy'
import { hungarian } from '../alloc/hungarian'
import { allocShape, sameAssignment } from '../alloc/shape'

const batch: Partial<SimConfig> = { layout: 'small', arrivalRate: Number.POSITIVE_INFINITY, seed: 1, strict: true }

describe('allocShape', () => {
  it('classifies a call by the number of robots m and candidate tasks pool', () => {
    expect(allocShape(1, 1)).toEqual({ m1: true, pool1: true, nondegenerate: false })
    expect(allocShape(1, 5)).toEqual({ m1: true, pool1: false, nondegenerate: false })
    expect(allocShape(6, 1)).toEqual({ m1: false, pool1: true, nondegenerate: false })
    expect(allocShape(2, 2)).toEqual({ m1: false, pool1: false, nondegenerate: true })
    expect(allocShape(7, 3)).toEqual({ m1: false, pool1: false, nondegenerate: true })
  })

  it('tells apart a matrix on which greedy and Hungarian differ', () => {
    // Greedy takes the cheapest pair (0,0)=1 and is left with (1,1)=100: total 101.
    // Hungarian takes (0,1)=2 and (1,0)=2: total 4.
    const differ = [
      [1, 2],
      [2, 100],
    ]
    expect(greedyAssign(differ)).toEqual([0, 1])
    expect(hungarian(differ)).toEqual([1, 0])
    expect(sameAssignment(greedyAssign(differ), hungarian(differ))).toBe(false)
    // One row: both pick the cheapest column.
    const one = [[5, 3, 4]]
    expect(sameAssignment(greedyAssign(one), hungarian(one))).toBe(true)
    // Infeasible entries: both leave the row without a column.
    const none = [[Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]]
    expect(greedyAssign(none)).toEqual([-1])
    expect(hungarian(none)).toEqual([-1])
    expect(sameAssignment([0, -1], [0])).toBe(false)
  })
})

describe('allocation-shape counters in a run', () => {
  it('one robot and three tasks: three calls, all with m = 1, only the last with pool = 1', () => {
    // Each call assigns one task, so there are exactly three calls. The robot is
    // the only eligible robot every time. The calls see 3, 2 and 1 pending tasks.
    for (const alloc of ['greedy', 'hungarian', 'pact', 'pact-proxy'] as const) {
      const m = new FleetSimulator({ ...batch, fleetSize: 1, numTasks: 3, alloc }).run()
      expect(m.tasksCompleted).toBe(3)
      expect(m.allocCalls).toBe(3)
      expect(m.allocM1).toBe(3)
      expect(m.allocPool1).toBe(1)
      expect(m.allocNondegenerate).toBe(0)
      expect(m.allocGreedyEqHungarian).toBe(3)
      expect(m.cplAllocs).toBe(alloc === 'pact' || alloc === 'pact-proxy' ? 3 : 0)
      expect(m.cplAllocsMatchDifferNondegenerate).toBe(0)
    }
  })

  it('two robots and two tasks: one call with m = 2 and pool = 2, a real assignment problem', () => {
    for (const alloc of ['greedy', 'hungarian', 'pact', 'pact-proxy'] as const) {
      const m = new FleetSimulator({ ...batch, fleetSize: 2, numTasks: 2, alloc }).run()
      expect(m.tasksCompleted).toBe(2)
      expect(m.allocCalls).toBe(1)
      expect(m.allocM1).toBe(0)
      expect(m.allocPool1).toBe(0)
      expect(m.allocNondegenerate).toBe(1)
      expect(m.allocGreedyEqHungarian).toBe(1)
    }
  })

  it('obey the identities between the counters and the existing coupling counters', () => {
    for (const alloc of ['greedy', 'hungarian', 'pact', 'pact-proxy'] as const) {
      const m = new FleetSimulator({ layout: 'warehouse', fleetSize: 16, numTasks: 60, arrivalRate: Number.POSITIVE_INFINITY, seed: 5, alloc }).run()
      expect(m.allocCalls).toBeGreaterThan(0)
      expect(m.allocNondegenerate).toBeLessThanOrEqual(m.allocCalls)
      // A degenerate call has m = 1 or pool = 1 (or both), and the other calls are real.
      expect(m.allocCalls - m.allocNondegenerate).toBeLessThanOrEqual(m.allocM1 + m.allocPool1)
      expect(m.allocCalls - m.allocNondegenerate).toBeGreaterThanOrEqual(Math.max(m.allocM1, m.allocPool1))
      expect(m.allocGreedyEqHungarian).toBeLessThanOrEqual(m.allocCalls)
      if (alloc === 'pact' || alloc === 'pact-proxy') {
        expect(m.allocCalls).toBe(m.cplAllocs)
        expect(m.cplAllocsMatchDifferNondegenerate).toBeLessThanOrEqual(m.cplAllocsMatchDiffer)
        expect(m.cplAllocsMatchDifferNondegenerate).toBeLessThanOrEqual(m.allocNondegenerate)
      } else {
        expect(m.cplAllocs + m.cplAllocsMatchDiffer + m.cplAllocsMatchDifferNondegenerate).toBe(0)
      }
    }
  })

  it('leave every earlier metric of a committed record unchanged', () => {
    // main sweep, warehouse, 8 robots, batch, PACT, seed 1: the record written before the counters existed.
    const records = JSON.parse(readFileSync(join(process.cwd(), 'paper/experiments/results/main.json'), 'utf8')) as Array<Record<string, unknown>>
    const rec = records.find((r) => r.layout === 'warehouse' && r.fleetSize === 8 && r.arrivalRate === null && r.variant === 'pact' && r.seed === 1)
    expect(rec).toBeDefined()
    const m = new FleetSimulator({ layout: 'warehouse', fleetSize: 8, arrivalRate: Number.POSITIVE_INFINITY, alloc: 'pact', numTasks: 200, seed: 1, strict: true }).run() as unknown as Record<string, unknown>
    const clock = new Set(['wallMs', 'plannerMs', 'allocMs', 'diagMs', 'plannerMsPerTick'])
    for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
      if (clock.has(k) || !(k in m)) continue
      // Infinity is stored as null in JSON.
      expect(m[k] === Number.POSITIVE_INFINITY ? null : m[k], k).toEqual(v)
    }
  })

  it('records the wall time of every epoch outside the diagnostics', () => {
    const sim = new FleetSimulator({ ...batch, fleetSize: 4, numTasks: 20, alloc: 'pact' })
    const m = sim.run()
    expect(sim.epochMs.length).toBe(m.epochs)
    expect(sim.epochMs.every((x) => x >= 0)).toBe(true)
    expect(m.diagMs).toBeGreaterThan(0)
    // plannerMs also holds the single-robot re-plans between epochs, so the epochs are a part of it.
    expect(sim.epochMs.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(m.plannerMs)
  })
})
