/**
 * Benchmark layouts.
 *
 * - `small`     : hand-drawn 16x10 open floor used for CBS tests and tiny fleets.
 * - `warehouse` : 4 shelf blocks x 5 lines of 10-cell shelves, 2-wide aisles,
 *                 dead-end bays for homes, chargers and docks along the walls.
 * - `narrow`    : the warehouse pattern with one-lane aisles (1 aisle row
 *                 per shelf line), 4 blocks x 4 lines, 6 docks.
 * - `console`   : 2x2 zone grid (A/B/C/D) whose per-zone shelf-line and dock
 *                 counts come from the operator console's own wireframe data
 *                 (src/fms/map/console_site.json, produced by
 *                 scripts/extract-console-site.ts).
 *
 * All generated layouts satisfy the "well-formed" property used by lifelong
 * MAPD (Ma et al., 2017): every home bay, charger slot and dock is a dead-end
 * pocket off a corridor, so a robot resting there never blocks another robot's
 * path between endpoints.
 */
import { parseAsciiMap, type GridMap } from './grid'
import consoleSite from './console_site.json'

export interface BlockLayoutSpec {
  name: string
  /** lines[zoneRow][zoneCol] = number of shelf lines in that zone. */
  zoneLines: number[][]
  shelfLen: number
  homes: number
  docks: number
  chargerStations: number
  slotsPerStation: number
  /** Aisle rows below each shelf line (2 = two-lane aisles, 1 = one-lane). Default 2. */
  aisleRows?: number
  /** Extra free rows between the last shelf line and the bottom wall. Default 0. */
  bottomCorridor?: number
}

const CORRIDOR = 2

/**
 * Generic generator: zones arranged in a grid, each zone is a stack of shelf
 * lines (1 shelf row + 2 aisle rows), zones separated by 2-wide cross aisles,
 * endpoints in wall pockets.
 */
export function buildBlockLayout(spec: BlockLayoutSpec): string {
  const zoneRows = spec.zoneLines.length
  const zoneCols = spec.zoneLines[0].length
  const aisleRows = spec.aisleRows ?? 2
  const lineHeight = 1 + aisleRows
  // One-lane aisles are closed by an extra shelf row below the last line, so
  // that every aisle is bounded by shelves on both sides.
  const closing = aisleRows === 1 ? 1 : 0
  const rowHeights = spec.zoneLines.map((row) => Math.max(...row) * lineHeight + closing)
  const width = 1 + CORRIDOR + zoneCols * spec.shelfLen + (zoneCols - 1) * CORRIDOR + CORRIDOR + 1
  const height = 1 + CORRIDOR + rowHeights.reduce((a, b) => a + b, 0) + (spec.bottomCorridor ?? 0) + 1
  const grid: string[][] = []
  for (let y = 0; y < height; y += 1) {
    const row: string[] = []
    for (let x = 0; x < width; x += 1) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1
      row.push(border ? '#' : '.')
    }
    grid.push(row)
  }
  // Shelves and pickups.
  let yBase = 1 + CORRIDOR
  for (let zr = 0; zr < zoneRows; zr += 1) {
    for (let zc = 0; zc < zoneCols; zc += 1) {
      const xBase = 1 + CORRIDOR + zc * (spec.shelfLen + CORRIDOR)
      const lines = spec.zoneLines[zr][zc]
      for (let li = 0; li < lines; li += 1) {
        const y = yBase + li * lineHeight
        for (let k = 0; k < spec.shelfLen; k += 1) {
          grid[y][xBase + k] = '@'
          if (k % 2 === 0) grid[y + 1][xBase + k] = 'P'
        }
      }
      if (closing) for (let k = 0; k < spec.shelfLen; k += 1) grid[yBase + lines * lineHeight][xBase + k] = '@'
    }
    yBase += rowHeights[zr]
  }
  // Wall pockets. Top and bottom walls: homes. Left wall: chargers. Right wall: docks.
  const topSlots: Array<[number, number]> = []
  for (let x = CORRIDOR; x <= width - 1 - CORRIDOR; x += 2) topSlots.push([x, 0])
  const bottomSlots: Array<[number, number]> = []
  for (let x = CORRIDOR; x <= width - 1 - CORRIDOR; x += 2) bottomSlots.push([x, height - 1])
  const homeSlots = [...topSlots, ...bottomSlots]
  if (spec.homes > homeSlots.length) {
    throw new Error(`layout ${spec.name}: ${spec.homes} homes requested, ${homeSlots.length} pockets available`)
  }
  for (let i = 0; i < spec.homes; i += 1) {
    const [x, y] = homeSlots[i]
    grid[y][x] = 'H'
  }
  // Chargers: stations of `slotsPerStation` consecutive pockets separated by wall.
  let y = 1
  for (let s = 0; s < spec.chargerStations; s += 1) {
    for (let k = 0; k < spec.slotsPerStation; k += 1) {
      if (y + k >= height - 1) throw new Error(`layout ${spec.name}: not enough wall for chargers`)
      grid[y + k][0] = 'C'
    }
    y += spec.slotsPerStation + 1
  }
  // Docks on the right wall, one pocket every other row.
  const dockSlots: Array<[number, number]> = []
  for (let yy = 1; yy <= height - 2; yy += 2) dockSlots.push([width - 1, yy])
  if (spec.docks > dockSlots.length) {
    throw new Error(`layout ${spec.name}: ${spec.docks} docks requested, ${dockSlots.length} pockets available`)
  }
  for (let i = 0; i < spec.docks; i += 1) {
    const [x, yy] = dockSlots[i]
    grid[yy][x] = 'D'
  }
  return grid.map((r) => r.join('')).join('\n')
}

export const SMALL_ASCII = [
  '################',
  '#H.P........P.H#',
  '#H............H#',
  '#..............#',
  '#C....####....D#',
  '#C....####....D#',
  '#..............#',
  '#H............H#',
  '#H.P........P.H#',
  '################',
].join('\n')

export function smallLayout(): GridMap {
  return parseAsciiMap('small', SMALL_ASCII)
}

export const WAREHOUSE_SPEC: BlockLayoutSpec = {
  name: 'warehouse',
  zoneLines: [[5, 5, 5, 5]],
  shelfLen: 10,
  homes: 48,
  docks: 9,
  chargerStations: 4,
  slotsPerStation: 2,
}

export function warehouseLayout(): GridMap {
  return parseAsciiMap('warehouse', buildBlockLayout(WAREHOUSE_SPEC))
}

/**
 * One-lane variant of the warehouse: every shelf line has a single aisle row
 * (open at both ends to 2-wide cross aisles), so robots cannot pass each other
 * inside an aisle and a robot loading at a pickup blocks its aisle.
 */
export const NARROW_SPEC: BlockLayoutSpec = {
  name: 'narrow',
  zoneLines: [[4, 4, 4, 4]],
  shelfLen: 10,
  homes: 32,
  docks: 6,
  chargerStations: 4,
  slotsPerStation: 2,
  aisleRows: 1,
  bottomCorridor: 2,
}

export function narrowLayout(): GridMap {
  return parseAsciiMap('narrow', buildBlockLayout(NARROW_SPEC))
}

interface ConsoleSite {
  zones: Record<string, { lines: number; docks: number }>
}

/** Console-derived layout: zones A,B on the upper row, C,D on the lower row. */
export function consoleSpec(site: ConsoleSite = consoleSite as ConsoleSite): BlockLayoutSpec {
  const z = site.zones
  const line = (k: string) => Math.max(1, z[k]?.lines ?? 1)
  const docks = Object.values(z).reduce((a, b) => a + b.docks, 0)
  return {
    name: 'console',
    zoneLines: [
      [line('A'), line('B')],
      [line('C'), line('D')],
    ],
    shelfLen: 14,
    homes: 32,
    // Each shipping dock named in the console ("C구역 출하 도크 n") becomes a bay of
    // three delivery pockets; the console names 2 docks -> 6 delivery cells.
    docks: Math.max(2, docks) * 3,
    chargerStations: 3,
    slotsPerStation: 2,
  }
}

export function consoleLayout(): GridMap {
  return parseAsciiMap('console', buildBlockLayout(consoleSpec()))
}

export const LAYOUTS: Record<string, () => GridMap> = {
  small: smallLayout,
  warehouse: warehouseLayout,
  console: consoleLayout,
  narrow: narrowLayout,
}

export function loadLayout(name: string): GridMap {
  const factory = LAYOUTS[name]
  if (!factory) throw new Error(`unknown layout '${name}' (known: ${Object.keys(LAYOUTS).join(', ')})`)
  return factory()
}
