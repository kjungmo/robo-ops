import { describe, expect, it } from 'vitest'
import { parseAsciiMap } from '../map/grid'
import { TrajectoryAuditor, type ObservedRobot, type ObservedSim } from '../sim/audit'
import { FleetSimulator } from '../sim/simulator'

const MAP = parseAsciiMap('t', ['......', '..#...', '......'].join('\n'))

/** A scripted "simulation": robots follow given cell sequences. */
function scripted(tracks: number[][], soc?: number[][]): { sim: ObservedSim; advance: () => void } {
  let t = 0
  const robots: ObservedRobot[] = tracks.map((tr, i) => ({ cell: tr[0], soc: soc ? soc[i][0] : 1, status: 'to_pickup', goal: 17 }))
  const sim: ObservedSim = {
    get tick() {
      return t
    },
    robots,
    progressCount: () => 0,
    outstandingTasks: () => 1,
  }
  const advance = () => {
    t += 1
    tracks.forEach((tr, i) => {
      const r = robots[i] as { cell: number; soc: number }
      r.cell = tr[Math.min(t, tr.length - 1)]
      if (soc) r.soc = soc[i][Math.min(t, soc[i].length - 1)]
    })
  }
  return { sim, advance }
}

function audit(tracks: number[][], ticks: number, soc?: number[][]) {
  const { sim, advance } = scripted(tracks, soc)
  const a = new TrajectoryAuditor(MAP, 0.2, sim)
  for (let k = 0; k < ticks; k += 1) {
    advance()
    a.observe(sim)
  }
  return a.report()
}

describe('trajectory auditor', () => {
  it('reports nothing for conflict-free unit moves', () => {
    const r = audit([
      [0, 1, 2, 3],
      [6, 12, 13, 14],
    ], 3)
    expect(r.vertexConflicts + r.swapConflicts + r.illegalMoves + r.depletions).toBe(0)
    expect(r.robotTicks).toBe(6)
  })

  it('detects vertex conflicts, including a following robot that stops on a shared cell', () => {
    expect(audit([[0, 1], [2, 1]], 1).vertexConflicts).toBe(1)
    // Following into a just-vacated cell is allowed.
    expect(audit([[0, 1, 2], [1, 2, 3]], 2).vertexConflicts).toBe(0)
  })

  it('detects swap conflicts but not rotations of three', () => {
    expect(audit([[0, 1], [1, 0]], 1).swapConflicts).toBe(1)
    // 0->1, 1->7, 7->6, 6->0 is a cycle of four, not a swap.
    expect(audit([[0, 1], [1, 7], [7, 6], [6, 0]], 1).swapConflicts).toBe(0)
  })

  it('detects jumps, moves onto obstacles and moving depleted robots', () => {
    expect(audit([[0, 2]], 1).illegalMoves).toBe(1)
    expect(audit([[7, 8]], 1).illegalMoves).toBe(1) // cell 8 is the obstacle
    const r = audit([[0, 1, 2]], 2, [[0.1, 0, 0]])
    expect(r.depletions).toBe(1)
    expect(r.illegalMoves).toBe(1)
  })

  it('measures the longest interval without progress', () => {
    const r = audit([[0, 0, 0, 0, 0]], 4)
    expect(r.maxNoProgress).toBe(4)
    expect(r.maxWaitStreak).toBe(4)
  })

  it('agrees with the simulator on a real run (zero events, same robot-ticks)', () => {
    const sim = new FleetSimulator({ layout: 'small', fleetSize: 6, numTasks: 40, arrivalRate: 0.4, seed: 4 })
    const a = new TrajectoryAuditor(sim.map, sim.cfg.battery.socLow, sim)
    while (!sim.finished) {
      sim.step()
      a.observe(sim)
    }
    const m = sim.metrics()
    const r = a.report()
    expect(r.vertexConflicts + r.swapConflicts + r.illegalMoves).toBe(m.conflicts)
    expect(r.depletions).toBe(m.depletionEvents)
    expect(r.ticks).toBe(m.makespan)
    expect(r.maxNoProgress).toBeLessThan(sim.cfg.stallLimit)
  })
})
