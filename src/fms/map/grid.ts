/**
 * 4-connected grid map model used by every FMS module.
 *
 * Cells are addressed by a single integer index `y * width + x`. Endpoint
 * classes mirror what the operator console already shows: pickup points on
 * shelf lines, delivery docks (출하 도크), charging slots (충전소) and home /
 * parking bays (대기 구역).
 *
 * ASCII encoding accepted by {@link parseAsciiMap}:
 *   `#` or `@`  obstacle (wall / shelf)
 *   `.`         free floor
 *   `P`         pickup endpoint
 *   `D`         delivery dock endpoint
 *   `H`         home / parking bay
 *   `C`         charger slot; 4-adjacent `C` cells form one charging station
 */
export type Cell = number

export interface ChargerStation {
  readonly id: string
  /** One robot may occupy each slot at a time: capacity = slots.length. */
  readonly slots: readonly Cell[]
}

export interface GridMap {
  readonly name: string
  readonly width: number
  readonly height: number
  /** 1 = blocked, 0 = traversable. */
  readonly blocked: Uint8Array
  readonly pickups: readonly Cell[]
  readonly deliveries: readonly Cell[]
  readonly homes: readonly Cell[]
  readonly chargers: readonly ChargerStation[]
  readonly ascii: string
}

export function cellIndex(map: GridMap, x: number, y: number): Cell {
  return y * map.width + x
}

export function cellX(map: GridMap, cell: Cell): number {
  return cell % map.width
}

export function cellY(map: GridMap, cell: Cell): number {
  return Math.floor(cell / map.width)
}

export function isFree(map: GridMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false
  return map.blocked[y * map.width + x] === 0
}

/** Free 4-neighbours in a fixed order (up, left, right, down) for determinism. */
export function neighbors(map: GridMap, cell: Cell): Cell[] {
  const x = cell % map.width
  const y = Math.floor(cell / map.width)
  const out: Cell[] = []
  if (isFree(map, x, y - 1)) out.push(cell - map.width)
  if (isFree(map, x - 1, y)) out.push(cell - 1)
  if (isFree(map, x + 1, y)) out.push(cell + 1)
  if (isFree(map, x, y + 1)) out.push(cell + map.width)
  return out
}

export function manhattan(map: GridMap, a: Cell, b: Cell): number {
  return Math.abs(cellX(map, a) - cellX(map, b)) + Math.abs(cellY(map, a) - cellY(map, b))
}

export function chargerSlots(map: GridMap): Cell[] {
  const out: Cell[] = []
  for (const station of map.chargers) out.push(...station.slots)
  return out
}

export function freeCellCount(map: GridMap): number {
  let n = 0
  for (let i = 0; i < map.blocked.length; i += 1) if (map.blocked[i] === 0) n += 1
  return n
}

export function parseAsciiMap(name: string, text: string): GridMap {
  const rows = text
    .split('\n')
    .map((r) => r.replace(/\r$/, ''))
    .filter((r) => r.trim().length > 0)
  if (rows.length === 0) throw new Error(`parseAsciiMap(${name}): empty map`)
  const width = rows[0].length
  const height = rows.length
  for (const [i, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(`parseAsciiMap(${name}): row ${i} has width ${row.length}, expected ${width}`)
    }
  }
  const blocked = new Uint8Array(width * height)
  const pickups: Cell[] = []
  const deliveries: Cell[] = []
  const homes: Cell[] = []
  const chargerCells: Cell[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ch = rows[y][x]
      const cell = y * width + x
      switch (ch) {
        case '#':
        case '@':
          blocked[cell] = 1
          break
        case '.':
          break
        case 'P':
          pickups.push(cell)
          break
        case 'D':
          deliveries.push(cell)
          break
        case 'H':
          homes.push(cell)
          break
        case 'C':
          chargerCells.push(cell)
          break
        default:
          throw new Error(`parseAsciiMap(${name}): unknown glyph '${ch}' at (${x},${y})`)
      }
    }
  }
  // Group 4-adjacent charger cells into stations.
  const chargerSet = new Set(chargerCells)
  const seen = new Set<Cell>()
  const chargers: ChargerStation[] = []
  for (const start of chargerCells) {
    if (seen.has(start)) continue
    const slots: Cell[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length > 0) {
      const c = stack.pop() as Cell
      slots.push(c)
      const x = c % width
      const y = Math.floor(c / width)
      const cand = [
        [x, y - 1],
        [x - 1, y],
        [x + 1, y],
        [x, y + 1],
      ]
      for (const [nx, ny] of cand) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const nc = ny * width + nx
        if (chargerSet.has(nc) && !seen.has(nc)) {
          seen.add(nc)
          stack.push(nc)
        }
      }
    }
    slots.sort((a, b) => a - b)
    chargers.push({ id: `CS-${String(chargers.length + 1).padStart(2, '0')}`, slots })
  }
  return {
    name,
    width,
    height,
    blocked,
    pickups,
    deliveries,
    homes,
    chargers,
    ascii: rows.join('\n'),
  }
}

/**
 * Exact shortest-path distances on the grid, computed by BFS from each goal on
 * demand and cached. Used both as the assignment cost and as the (consistent)
 * heuristic of space-time A*.
 */
export class DistanceOracle {
  private readonly cache = new Map<Cell, Int32Array>()
  readonly map: GridMap

  constructor(map: GridMap) {
    this.map = map
  }

  /** Distance table to `goal` (-1 = unreachable). */
  toGoal(goal: Cell): Int32Array {
    const cached = this.cache.get(goal)
    if (cached) return cached
    const { map } = this
    const dist = new Int32Array(map.width * map.height).fill(-1)
    if (map.blocked[goal] === 1) {
      this.cache.set(goal, dist)
      return dist
    }
    const queue = new Int32Array(map.width * map.height)
    let head = 0
    let tail = 0
    queue[tail++] = goal
    dist[goal] = 0
    while (head < tail) {
      const c = queue[head++]
      const d = dist[c] + 1
      for (const n of neighbors(map, c)) {
        if (dist[n] === -1) {
          dist[n] = d
          queue[tail++] = n
        }
      }
    }
    this.cache.set(goal, dist)
    return dist
  }

  dist(from: Cell, to: Cell): number {
    const d = this.toGoal(to)[from]
    return d < 0 ? Number.POSITIVE_INFINITY : d
  }

  /** Deterministic shortest path from `from` to `to` (inclusive of both). */
  shortestPath(from: Cell, to: Cell): Cell[] | null {
    const table = this.toGoal(to)
    if (table[from] < 0) return null
    const path: Cell[] = [from]
    let cur = from
    while (cur !== to) {
      const want = table[cur] - 1
      let next = -1
      for (const n of neighbors(this.map, cur)) {
        if (table[n] === want) {
          next = n
          break
        }
      }
      if (next < 0) return null
      path.push(next)
      cur = next
    }
    return path
  }
}
