import { describe, expect, it } from 'vitest'
import { FleetSimulator, type SimConfig } from '../sim/simulator'
import { DistanceOracle, chargerSlots, freeCellCount } from '../map/grid'
import { LAYOUTS, loadLayout } from '../map/layouts'

const base: Partial<SimConfig> = { numTasks: 40, arrivalRate: 0.4, strict: true }

describe('layouts', () => {
  it('parse with endpoints that are mutually reachable', () => {
    for (const name of Object.keys(LAYOUTS)) {
      const map = loadLayout(name)
      const oracle = new DistanceOracle(map)
      const endpoints = [...map.pickups, ...map.deliveries, ...map.homes, ...chargerSlots(map)]
      expect(endpoints.length).toBeGreaterThan(0)
      expect(map.chargers.length).toBeGreaterThan(0)
      expect(freeCellCount(map)).toBeGreaterThan(endpoints.length)
      for (const e of endpoints) expect(Number.isFinite(oracle.dist(endpoints[0], e))).toBe(true)
      // Endpoints are distinct cells.
      expect(new Set(endpoints).size).toBe(endpoints.length)
    }
  })

  it('console layout follows the site descriptor derived from the wireframes', () => {
    const map = loadLayout('console')
    expect(map.deliveries.length).toBe(6)
    expect(map.homes.length).toBe(32)
    expect(map.chargers.length).toBe(3)
  })
})

describe('simulator', () => {
  it('is deterministic under a fixed seed', () => {
    const a = new FleetSimulator({ ...base, layout: 'small', fleetSize: 4, seed: 12 })
    const b = new FleetSimulator({ ...base, layout: 'small', fleetSize: 4, seed: 12 })
    const ma = a.run()
    const mb = b.run()
    expect(ma).toEqual({ ...mb, plannerMs: ma.plannerMs, allocMs: ma.allocMs, plannerMsPerTick: ma.plannerMsPerTick })
    expect(a.robots.map((r) => [r.cell, r.soc, r.status])).toEqual(b.robots.map((r) => [r.cell, r.soc, r.status]))
    const c = new FleetSimulator({ ...base, layout: 'small', fleetSize: 4, seed: 13 }).run()
    expect(c.makespan === ma.makespan && c.meanServiceTime === ma.meanServiceTime).toBe(false)
  })

  it('completes every task with zero conflicts and zero depletions (all layouts, methods, planners)', () => {
    const cases: Array<Partial<SimConfig>> = [
      { layout: 'small', fleetSize: 4, alloc: 'greedy', mapf: 'pp' },
      { layout: 'small', fleetSize: 4, alloc: 'hungarian', mapf: 'cbs' },
      { layout: 'small', fleetSize: 6, alloc: 'pact', mapf: 'cbs' },
      { layout: 'warehouse', fleetSize: 12, alloc: 'pact-proxy', mapf: 'pp' },
      { layout: 'warehouse', fleetSize: 12, alloc: 'pact', mapf: 'pp' },
      { layout: 'console', fleetSize: 12, alloc: 'hungarian', mapf: 'pp' },
    ]
    for (const c of cases) {
      const m = new FleetSimulator({ ...base, ...c, seed: 5 }).run()
      expect(m.conflicts).toBe(0)
      expect(m.depletionEvents).toBe(0)
      expect(m.deadlocked).toBe(0)
      expect(m.tasksCompleted).toBe(40)
      expect(m.meanServiceTime).toBeGreaterThan(0)
    }
  })

  it('keeps the CBS backend conflict-free when a deferred robot holds on a CBS path', () => {
    // Regression: robots deferred from CBS (shared goal) were planned by PP without
    // the CBS-planned robots as external agents, so a hold could not release them
    // and the executed step conflicted (small, 8 robots, batch, seeds 21 and 17).
    for (const [seed, arrivalRate] of [
      [21, Number.POSITIVE_INFINITY],
      [17, 0.3],
    ]) {
      const m = new FleetSimulator({ layout: 'small', fleetSize: 8, numTasks: 100, arrivalRate, seed, mapf: 'cbs', alloc: 'hungarian', strict: true }).run()
      expect(m.conflicts).toBe(0)
      expect(m.deadlocked).toBe(0)
      expect(m.tasksCompleted).toBe(100)
    }
  })

  it('charges robots that start low and never strands them', () => {
    const m = new FleetSimulator({
      ...base,
      layout: 'warehouse',
      fleetSize: 8,
      seed: 3,
      initialSoc: [0.21, 0.3],
      numTasks: 60,
    }).run()
    expect(m.chargeSessions).toBeGreaterThan(0)
    expect(m.depletionEvents).toBe(0)
    expect(m.tasksCompleted).toBe(60)
  })

  it('respects charger capacity (one robot per slot)', () => {
    const sim = new FleetSimulator({ ...base, layout: 'small', fleetSize: 6, seed: 9, initialSoc: [0.15, 0.19], numTasks: 20 })
    const slots = new Set(chargerSlots(sim.map))
    while (!sim.finished) {
      sim.step()
      const onSlots = sim.robots.filter((r) => slots.has(r.cell)).map((r) => r.cell)
      expect(new Set(onSlots).size).toBe(onSlots.length)
      const charging = sim.robots.filter((r) => r.status === 'charging')
      expect(charging.length).toBeLessThanOrEqual(slots.size)
      for (const r of charging) expect(slots.has(r.cell)).toBe(true)
    }
    expect(sim.metrics().chargeSessions).toBeGreaterThan(0)
  })

  it('exposes a snapshot for the console', () => {
    const sim = new FleetSimulator({ ...base, layout: 'console', fleetSize: 6, seed: 1 })
    for (let i = 0; i < 50; i += 1) sim.step()
    const s = sim.snapshot()
    expect(s.robots.length).toBe(6)
    expect(s.tick).toBe(50)
    expect(s.robots.every((r) => r.name.startsWith('AMR-'))).toBe(true)
  })
})
