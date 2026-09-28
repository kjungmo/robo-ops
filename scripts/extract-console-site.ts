/**
 * Derive the site descriptor for the `console` benchmark layout from the
 * operator console's own wireframe data (src/data/pages/*.json).
 *
 * It scans every label for the zone / shelf-line / shipping-dock vocabulary the
 * screens already use ("A구역 3번 라인", "C구역 출하 도크 2", ...) and records,
 * per zone, the highest line and dock index seen. The geometry (shelf length,
 * aisle width, charger count) is chosen by the layout generator, not by the
 * console; see src/fms/map/layouts.ts.
 *
 *   npx tsx scripts/extract-console-site.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pagesDir = join(process.cwd(), 'src/data/pages')
const zones: Record<string, { lines: number; docks: number; sources: string[] }> = {}

for (const file of readdirSync(pagesDir).sort()) {
  if (!file.endsWith('.json')) continue
  const page = JSON.parse(readFileSync(join(pagesDir, file), 'utf8')) as {
    pageNodeId: string
    nodes: Record<string, { label?: string }>
  }
  for (const node of Object.values(page.nodes)) {
    const label = node.label ?? ''
    const line = label.match(/([A-D])구역 (\d+)번 (?:라인|통로)/)
    if (line) {
      const z = (zones[line[1]] ??= { lines: 0, docks: 0, sources: [] })
      z.lines = Math.max(z.lines, Number(line[2]))
      if (!z.sources.includes(page.pageNodeId)) z.sources.push(page.pageNodeId)
    }
    const dock = label.match(/([A-D])구역 출하 도크 (\d+)/)
    if (dock) {
      const z = (zones[dock[1]] ??= { lines: 0, docks: 0, sources: [] })
      z.docks = Math.max(z.docks, Number(dock[2]))
      if (!z.sources.includes(page.pageNodeId)) z.sources.push(page.pageNodeId)
    }
  }
}

const out = {
  derivedFrom: 'src/data/pages/*.json (wireframe labels)',
  zones: Object.fromEntries(Object.keys(zones).sort().map((k) => [k, zones[k]])),
}
const target = join(process.cwd(), 'src/fms/map/console_site.json')
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${target}`)
console.log(JSON.stringify(out, null, 2))
