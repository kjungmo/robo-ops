import { describe, expect, it } from 'vitest'
import { FleetSimulator, type SimConfig } from '../sim/simulator'
import { TrajectoryAuditor } from '../sim/audit'

const small8: Partial<SimConfig> = { layout: 'small', fleetSize: 8, numTasks: 100, arrivalRate: Number.POSITIVE_INFINITY, alloc: 'hungarian', seed: 1 }

const cache = new Map<string, ReturnType<typeof runUncached>>()
function run(priority?: SimConfig['priority']) {
  const key = priority ?? 'default'
  if (!cache.has(key)) cache.set(key, runUncached(priority))
  return cache.get(key) as ReturnType<typeof runUncached>
}
function runUncached(priority?: SimConfig['priority']) {
  const sim = new FleetSimulator({ ...small8, ...(priority ? { priority } : {}) })
  const auditor = new TrajectoryAuditor(sim.map, sim.cfg.battery.socLow, sim)
  while (!sim.finished) {
    sim.step()
    auditor.observe(sim)
  }
  const a = auditor.report()
  return { m: sim.metrics(), conflicts: a.vertexConflicts + a.swapConflicts + a.illegalMoves }
}

describe('priority schemes (split of the dynamic ordering, PREREG_v2 E4)', () => {
  it("'dynamic' is the default and is unchanged by the new values", () => {
    const key = (x: ReturnType<typeof run>) => [x.m.makespan, x.m.throughput, x.m.holdEvents, x.m.moveActions, x.m.waitActions, x.m.sumOfCosts, x.m.astarCalls]
    expect(key(run('dynamic'))).toEqual(key(run()))
  }, 60000)

  it('every scheme delivers all tasks without an executed conflict on small-8 (seed 1)', () => {
    for (const p of ['dynamic', 'held', 'blocking'] as const) {
      const r = run(p)
      expect(r.conflicts).toBe(0)
      expect(r.m.tasksCompleted).toBe(100)
      expect(r.m.deadlocked).toBe(0)
    }
    // Static priorities also execute no conflict; they may stall (that is what E4 measures).
    expect(run('static').conflicts).toBe(0)
  }, 60000)

  it('the four schemes plan differently', () => {
    const makespan = (p: SimConfig['priority']) => run(p).m.makespan
    const set = new Set([makespan('dynamic'), makespan('static'), makespan('held'), makespan('blocking')])
    expect(set.size).toBe(4)
    // held-first only keeps the evacuation of boxed-in robots, so it does not stall where static priorities do
    expect(run('held').m.deadlocked).toBe(0)
    expect(run('static').m.deadlocked).toBe(1)
  }, 60000)
})
