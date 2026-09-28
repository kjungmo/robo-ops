import { describe, expect, it } from 'vitest'
import { Rng } from '../core/rng'
import { DistanceOracle, parseAsciiMap, type Cell, type GridMap, neighbors } from '../map/grid'
import { smallLayout } from '../map/layouts'
import { NoConstraints, ReservationTable } from '../mapf/constraints'
import { spaceTimeAStar } from '../mapf/spacetime_astar'
import { prioritizedPlan, type PPAgent } from '../mapf/prioritized'
import { cbs } from '../mapf/cbs'
import { findFirstConflict, countConflicts } from '../mapf/conflicts'

function randomMap(rng: Rng, w: number, h: number, pObstacle: number): GridMap {
  const rows: string[] = []
  for (let y = 0; y < h; y += 1) {
    let row = ''
    for (let x = 0; x < w; x += 1) row += rng.next() < pObstacle ? '#' : '.'
    rows.push(row)
  }
  return parseAsciiMap('rand', rows.join('\n'))
}

function freeCells(map: GridMap): Cell[] {
  const out: Cell[] = []
  for (let c = 0; c < map.blocked.length; c += 1) if (map.blocked[c] === 0) out.push(c)
  return out
}

/** Pick n distinct starts and n distinct goals that are mutually reachable. */
function randomAgents(rng: Rng, map: GridMap, oracle: DistanceOracle, n: number): PPAgent[] | null {
  const cells = freeCells(map)
  if (cells.length < 2 * n) return null
  const starts = rng.shuffle([...cells]).slice(0, n)
  const goals = rng.shuffle([...cells]).slice(0, n)
  for (let i = 0; i < n; i += 1) if (!Number.isFinite(oracle.dist(starts[i], goals[i]))) return null
  return starts.map((s, i) => ({ id: i, start: s, goal: goals[i] }))
}

/** Every path must start at the agent's start and consist of unit moves or waits. */
function checkPathShape(map: GridMap, agent: PPAgent, path: Cell[]) {
  expect(path[0]).toBe(agent.start)
  for (let k = 1; k < path.length; k += 1) {
    const ok = path[k] === path[k - 1] || neighbors(map, path[k - 1]).includes(path[k])
    expect(ok).toBe(true)
    expect(map.blocked[path[k]]).toBe(0)
  }
}

describe('space-time A*', () => {
  it('equals BFS distance without constraints', () => {
    const rng = new Rng(3)
    for (let trial = 0; trial < 100; trial += 1) {
      const map = randomMap(rng, 8, 8, 0.25)
      const oracle = new DistanceOracle(map)
      const cells = freeCells(map)
      const s = rng.pick(cells)
      const g = rng.pick(cells)
      const d = oracle.dist(s, g)
      const r = spaceTimeAStar(map, oracle, s, g, new NoConstraints(50), 0)
      if (!Number.isFinite(d)) {
        expect(r).toBeNull()
      } else {
        expect(r).not.toBeNull()
        expect(r?.cost).toBe(d)
        expect(r?.path.length).toBe(d + 1)
      }
    }
  })

  it('respects vertex, edge and goal reservations', () => {
    const map = parseAsciiMap('corridor', ['#######', '#.....#', '#######'].join('\n'))
    const oracle = new DistanceOracle(map)
    const W = map.width
    const a = 1 * W + 1
    const b = 1 * W + 5
    const table = new ReservationTable(map.width * map.height, 30)
    // Agent 0 goes left->right along the corridor and rests at b.
    const p0 = spaceTimeAStar(map, oracle, a, b, table, 0)
    expect(p0?.cost).toBe(4)
    table.reservePath(0, p0?.path as Cell[], 0)
    // Agent 1 wants b->a: impossible within the window without a swap.
    const p1 = spaceTimeAStar(map, oracle, b, a, table, 0)
    expect(p1).toBeNull()
    // Agent 2 starting at the middle cannot rest on b (held), and cannot reach a
    // either because agent 0 must pass it in the 1-wide corridor (no overtaking).
    const mid = 1 * W + 3
    expect(spaceTimeAStar(map, oracle, mid, b, table, 0)).toBeNull()
    expect(spaceTimeAStar(map, oracle, mid, a, table, 0)).toBeNull()
    // With a second lane the same request succeeds by stepping aside, and the
    // returned path is consistent with the reservation.
    const wide = parseAsciiMap('wide', ['#######', '#.....#', '#.....#', '#######'].join('\n'))
    const wo = new DistanceOracle(wide)
    const W2 = wide.width
    const t2 = new ReservationTable(wide.width * wide.height, 30)
    const q0 = spaceTimeAStar(wide, wo, 1 * W2 + 1, 1 * W2 + 5, t2, 0)
    t2.reservePath(0, q0?.path as Cell[], 0)
    const q1 = spaceTimeAStar(wide, wo, 1 * W2 + 3, 1 * W2 + 1, t2, 0)
    expect(q1).not.toBeNull()
    const paths = new Map<number, Cell[]>([
      [0, q0?.path as Cell[]],
      [1, q1?.path as Cell[]],
    ])
    expect(findFirstConflict(paths, 30)).toBeNull()
    expect(q1?.cost).toBeGreaterThan(2)
  })
})

describe('prioritized planning', () => {
  it('produces conflict-free paths within the window on random instances (property)', () => {
    const rng = new Rng(11)
    let checked = 0
    for (let trial = 0; trial < 300; trial += 1) {
      const map = randomMap(rng, 6 + rng.int(6), 6 + rng.int(6), 0.2)
      const oracle = new DistanceOracle(map)
      const n = 2 + rng.int(7)
      const agents = randomAgents(rng, map, oracle, n)
      if (!agents) continue
      const W = 5 + rng.int(20)
      const table = new ReservationTable(map.width * map.height, W)
      const res = prioritizedPlan(map, oracle, agents, table, 0)
      const paths = new Map<number, Cell[]>()
      for (const a of agents) {
        const p = res.paths.get(a.id) as Cell[]
        expect(p).toBeDefined()
        checkPathShape(map, a, p)
        paths.set(a.id, p)
        if (!res.held.has(a.id)) expect(p[p.length - 1]).toBe(a.goal)
      }
      expect(findFirstConflict(paths, W)).toBeNull()
      checked += 1
    }
    expect(checked).toBeGreaterThan(200)
  })

  it('keeps consistency when a hold cascade re-plans external agents', () => {
    const rng = new Rng(5)
    let cascades = 0
    for (let trial = 0; trial < 300; trial += 1) {
      const map = randomMap(rng, 7, 7, 0.3)
      const oracle = new DistanceOracle(map)
      const agents = randomAgents(rng, map, oracle, 6)
      if (!agents) continue
      const W = 12
      const table = new ReservationTable(map.width * map.height, W)
      const first = agents.slice(0, 3)
      const second = agents.slice(3)
      const r1 = prioritizedPlan(map, oracle, first, table, 0)
      const r2 = prioritizedPlan(map, oracle, second, table, 0, first)
      if (r2.held.size > 0) cascades += 1
      const paths = new Map<number, Cell[]>()
      for (const a of agents) paths.set(a.id, (r2.paths.get(a.id) ?? r1.paths.get(a.id)) as Cell[])
      expect(findFirstConflict(paths, W)).toBeNull()
    }
    expect(cascades).toBeGreaterThan(0)
  })
})

/**
 * Exhaustive optimal sum-of-costs by Dijkstra over the joint state space with
 * explicit "finished" flags: a finished agent rests on its goal forever; an
 * unfinished agent pays one unit per step. Identical semantics to CBS.
 */
function jointOptimalSoC(map: GridMap, agents: PPAgent[]): number | null {
  const n = agents.length
  const V = map.width * map.height
  const encode = (cells: number[], flags: number) => cells.reduce((acc, c) => acc * V + c, 0) * (1 << n) + flags
  const dist = new Map<number, number>()
  const startKey = encode(agents.map((a) => a.start), 0)
  dist.set(startKey, 0)
  // Simple priority queue via sorted buckets (costs are small integers).
  const buckets = new Map<number, Array<{ cells: number[]; flags: number }>>()
  buckets.set(0, [{ cells: agents.map((a) => a.start), flags: 0 }])
  let cost = 0
  const maxCost = 200
  while (cost <= maxCost) {
    const bucket = buckets.get(cost)
    if (!bucket || bucket.length === 0) {
      cost += 1
      continue
    }
    const { cells, flags } = bucket.pop() as { cells: number[]; flags: number }
    const key = encode(cells, flags)
    if ((dist.get(key) as number) < cost) continue
    if (flags === (1 << n) - 1) return cost
    // Enumerate joint moves.
    const options: number[][] = agents.map((_a, i) => {
      if (flags & (1 << i)) return [cells[i]]
      const opts = [cells[i], ...neighbors(map, cells[i])]
      return opts
    })
    const finishOptions: boolean[][] = agents.map((a, i) => (flags & (1 << i) ? [true] : cells[i] === a.goal ? [false, true] : [false]))
    const rec = (i: number, next: number[], nextFlags: number, stepCost: number) => {
      if (i === n) {
        // Conflicts.
        for (let p = 0; p < n; p += 1) {
          for (let q = p + 1; q < n; q += 1) {
            if (next[p] === next[q]) return
            if (next[p] === cells[q] && next[q] === cells[p] && cells[p] !== cells[q]) return
          }
        }
        const k = encode(next, nextFlags)
        const c = cost + stepCost
        const prev = dist.get(k)
        if (prev === undefined || c < prev) {
          dist.set(k, c)
          if (!buckets.has(c)) buckets.set(c, [])
          ;(buckets.get(c) as Array<{ cells: number[]; flags: number }>).push({ cells: next, flags: nextFlags })
        }
        return
      }
      for (const fin of finishOptions[i]) {
        if (fin) {
          // Finish now (no move, no cost); only valid if at goal or already finished.
          if (flags & (1 << i)) rec(i + 1, [...next, cells[i]], nextFlags | (1 << i), stepCost)
          else rec(i + 1, [...next, cells[i]], nextFlags | (1 << i), stepCost)
        } else {
          for (const o of options[i]) rec(i + 1, [...next, o], nextFlags, stepCost + 1)
        }
      }
    }
    rec(0, [], 0, 0)
  }
  return null
}

describe('CBS', () => {
  it('is conflict-free and matches exhaustive joint search on tiny grids', () => {
    const rng = new Rng(21)
    let compared = 0
    let limited = 0
    for (let trial = 0; trial < 120; trial += 1) {
      const w = 3 + rng.int(2)
      const h = 3
      const map = randomMap(rng, w, h, 0.15)
      const oracle = new DistanceOracle(map)
      const n = 2 + rng.int(2)
      const agents = randomAgents(rng, map, oracle, n)
      if (!agents) continue
      const goals = new Set(agents.map((a) => a.goal))
      if (goals.size !== n) continue
      const res = cbs(map, oracle, agents, null, 0, 60, { maxNodes: 50000 })
      const opt = jointOptimalSoC(map, agents)
      if (opt === null) {
        expect(res.status).not.toBe('ok')
        continue
      }
      if (res.status === 'limit') {
        // Basic CBS (no symmetry reasoning) needs ~2^(opt - lower bound) nodes when
        // an agent must vacate its own goal; such instances exist even on 3x3 grids.
        limited += 1
        continue
      }
      expect(res.status).toBe('ok')
      expect(findFirstConflict(res.paths, 60)).toBeNull()
      expect(res.cost).toBe(opt)
      compared += 1
    }
    expect(compared).toBeGreaterThan(40)
    expect(limited).toBeLessThanOrEqual(3)
  })

  it('never exceeds prioritized planning cost when both succeed', () => {
    const map = smallLayout()
    const oracle = new DistanceOracle(map)
    const rng = new Rng(8)
    let compared = 0
    for (let trial = 0; trial < 100; trial += 1) {
      const agents = randomAgents(rng, map, oracle, 4)
      if (!agents) continue
      if (new Set(agents.map((a) => a.goal)).size !== 4) continue
      const W = 20
      const res = cbs(map, oracle, agents, null, 0, W, { maxNodes: 20000 })
      const table = new ReservationTable(map.width * map.height, W)
      const pp = prioritizedPlan(map, oracle, agents, table, 0)
      if (res.status !== 'ok' || pp.held.size > 0) continue
      let ppCost = 0
      for (const a of agents) ppCost += (pp.paths.get(a.id) as Cell[]).length - 1
      expect(countConflicts(res.paths, W)).toBe(0)
      expect(res.cost).toBeLessThanOrEqual(ppCost)
      compared += 1
    }
    expect(compared).toBeGreaterThan(50)
  })
})
