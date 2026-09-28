/**
 * FMS benchmark driver.
 *
 *   npm run bench:fms                # all sweeps
 *   npm run bench:fms -- main        # one sweep (main | planner | scaling | ablation | battery)
 *
 * Writes paper/experiments/results/<sweep>.json (one record per run),
 * <sweep>.csv (same, flat) and <sweep>_summary.csv (mean/std per configuration),
 * plus bench-meta.json with machine and version information.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cpus, totalmem } from 'node:os'
import { execSync } from 'node:child_process'
import { FleetSimulator, type SimConfig } from '../src/fms/index'
import type { SimMetrics } from '../src/fms/sim/metrics'

const SEEDS = [1, 2, 3, 4, 5]
const OUT = join(process.cwd(), 'paper/experiments/results')

type Run = SimMetrics & { sweep: string; variant: string; wallMs: number }

interface Sweep {
  name: string
  configs: Array<{ variant: string; cfg: Partial<SimConfig> }>
}

function grid<T>(...axes: T[][]): T[][] {
  return axes.reduce<T[][]>((acc, axis) => acc.flatMap((prefix) => axis.map((v) => [...prefix, v])), [[]])
}

function sweeps(): Sweep[] {
  const out: Sweep[] = []
  // Main comparison: allocation methods across layouts, fleet sizes and load regimes.
  {
    const configs: Sweep['configs'] = []
    for (const [layout, fleet, rate, alloc] of grid<string | number>(
      ['warehouse', 'console'],
      [8, 16, 32],
      [0.15, Number.POSITIVE_INFINITY],
      ['greedy', 'hungarian', 'pact-proxy', 'pact'],
    )) {
      configs.push({
        variant: String(alloc),
        cfg: { layout: String(layout), fleetSize: Number(fleet), arrivalRate: Number(rate), alloc: alloc as SimConfig['alloc'], numTasks: 200 },
      })
    }
    out.push({ name: 'main', configs })
  }
  // Planner comparison on the small layout: prioritized planning vs windowed CBS.
  {
    const configs: Sweep['configs'] = []
    for (const [fleet, mapf] of grid<string | number>([4, 6, 8], ['pp', 'cbs'])) {
      configs.push({
        variant: String(mapf),
        cfg: { layout: 'small', fleetSize: Number(fleet), arrivalRate: Number.POSITIVE_INFINITY, alloc: 'hungarian', mapf: mapf as SimConfig['mapf'], numTasks: 100 },
      })
    }
    out.push({ name: 'planner', configs })
  }
  // Fleet-size scaling (throughput and planner runtime).
  {
    const configs: Sweep['configs'] = []
    for (const [fleet, alloc] of grid<string | number>([4, 8, 16, 24, 32, 40, 48], ['hungarian', 'pact'])) {
      configs.push({
        variant: String(alloc),
        cfg: { layout: 'warehouse', fleetSize: Number(fleet), arrivalRate: Number.POSITIVE_INFINITY, alloc: alloc as SimConfig['alloc'], numTasks: 200 },
      })
    }
    out.push({ name: 'scaling', configs })
  }
  // Ablations of the coupled allocation on warehouse / 32 robots / batch load.
  {
    const common: Partial<SimConfig> = { layout: 'warehouse', fleetSize: 32, arrivalRate: Number.POSITIVE_INFINITY, numTasks: 200 }
    const configs: Sweep['configs'] = [
      { variant: 'pact', cfg: { ...common, alloc: 'pact' } },
      { variant: 'pact-noBattery', cfg: { ...common, alloc: 'pact', wBattery: 0 } },
      { variant: 'hungarian-noBattery', cfg: { ...common, alloc: 'hungarian', wBattery: 0 } },
      { variant: 'pact-w10', cfg: { ...common, alloc: 'pact', window: 10, period: 5 } },
      { variant: 'pact-w30', cfg: { ...common, alloc: 'pact', window: 30, period: 5 } },
      { variant: 'pact-h1', cfg: { ...common, alloc: 'pact', period: 1 } },
      { variant: 'pact-K3', cfg: { ...common, alloc: 'pact', candidateK: 3 } },
      { variant: 'pact-K12', cfg: { ...common, alloc: 'pact', candidateK: 12 } },
      { variant: 'pact-dock2', cfg: { ...common, alloc: 'pact', dockCapacity: 2 } },
      { variant: 'hungarian-dock2', cfg: { ...common, alloc: 'hungarian', dockCapacity: 2 } },
      { variant: 'pact-noEvent', cfg: { ...common, alloc: 'pact', eventReplan: false } },
      { variant: 'hungarian-noEvent', cfg: { ...common, alloc: 'hungarian', eventReplan: false } },
    ]
    out.push({ name: 'ablation', configs })
  }
  // Battery stress: fleets that start nearly empty must charge during the run.
  {
    const common: Partial<SimConfig> = { layout: 'warehouse', fleetSize: 16, arrivalRate: Number.POSITIVE_INFINITY, numTasks: 200, initialSoc: [0.2, 0.4] }
    const configs: Sweep['configs'] = [
      { variant: 'hungarian', cfg: { ...common, alloc: 'hungarian' } },
      { variant: 'hungarian-noBattery', cfg: { ...common, alloc: 'hungarian', wBattery: 0 } },
      { variant: 'pact', cfg: { ...common, alloc: 'pact' } },
      { variant: 'pact-noBattery', cfg: { ...common, alloc: 'pact', wBattery: 0 } },
    ]
    out.push({ name: 'battery', configs })
  }
  return out
}

const NUMERIC: Array<keyof SimMetrics> = [
  'makespan',
  'tasksCompleted',
  'tasksUnfinished',
  'deadlocked',
  'throughput',
  'meanServiceTime',
  'meanWaitTime',
  'meanExecTime',
  'sumOfCosts',
  'moveActions',
  'waitActions',
  'conflicts',
  'depletionEvents',
  'chargeSessions',
  'holdEvents',
  'cbsFallbacks',
  'epochs',
  'astarCalls',
  'expansions',
  'plannerMs',
  'allocMs',
  'plannerMsPerTick',
  'utilization',
  'finalMeanSoc',
]

function csvValue(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : v === Number.POSITIVE_INFINITY ? 'inf' : 'nan'
  return String(v)
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0])
  const lines = [cols.join(',')]
  for (const r of rows) lines.push(cols.map((c) => csvValue(r[c])).join(','))
  return `${lines.join('\n')}\n`
}

function summarise(runs: Run[]): Record<string, unknown>[] {
  const groups = new Map<string, Run[]>()
  for (const r of runs) {
    const key = [r.sweep, r.layout, r.fleetSize, r.arrivalRate, r.variant, r.mapf].join('|')
    if (!groups.has(key)) groups.set(key, [])
    ;(groups.get(key) as Run[]).push(r)
  }
  const rows: Record<string, unknown>[] = []
  for (const g of groups.values()) {
    const row: Record<string, unknown> = {
      sweep: g[0].sweep,
      layout: g[0].layout,
      fleetSize: g[0].fleetSize,
      arrivalRate: g[0].arrivalRate,
      variant: g[0].variant,
      alloc: g[0].alloc,
      mapf: g[0].mapf,
      n: g.length,
    }
    for (const k of NUMERIC) {
      const xs = g.map((r) => r[k] as number)
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length
      const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : 0
      row[`${k}_mean`] = Number(mean.toFixed(4))
      row[`${k}_std`] = Number(sd.toFixed(4))
    }
    rows.push(row)
  }
  return rows
}

function main() {
  const only = process.argv.slice(2)
  mkdirSync(OUT, { recursive: true })
  const started = Date.now()
  const all: Run[] = []
  for (const sweep of sweeps()) {
    if (only.length > 0 && !only.includes(sweep.name)) continue
    const runs: Run[] = []
    const t0 = Date.now()
    for (const { variant, cfg } of sweep.configs) {
      for (const seed of SEEDS) {
        const w0 = performance.now()
        const sim = new FleetSimulator({ ...cfg, seed, strict: true })
        const m = sim.run()
        runs.push({ ...m, sweep: sweep.name, variant, wallMs: performance.now() - w0 })
      }
      const last = runs[runs.length - 1]
      console.log(
        `[${sweep.name}] ${cfg.layout} n=${cfg.fleetSize} rate=${cfg.arrivalRate} ${variant}${cfg.mapf ? '/' + cfg.mapf : ''}: makespan=${last.makespan} service=${last.meanServiceTime.toFixed(1)} conflicts=${last.conflicts} deadlocked=${last.deadlocked} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      )
    }
    writeFileSync(join(OUT, `${sweep.name}.json`), `${JSON.stringify(runs, null, 1)}\n`)
    writeFileSync(join(OUT, `${sweep.name}.csv`), toCsv(runs as unknown as Record<string, unknown>[]))
    writeFileSync(join(OUT, `${sweep.name}_summary.csv`), toCsv(summarise(runs)))
    all.push(...runs)
  }
  let commit = 'unknown'
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    // not a git checkout
  }
  const meta = {
    date: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memoryGB: Number((totalmem() / 1024 ** 3).toFixed(1)),
    commit,
    seeds: SEEDS,
    sweeps: only.length > 0 ? only : sweeps().map((s) => s.name),
    runs: all.length,
    totalConflicts: all.reduce((a, r) => a + r.conflicts, 0),
    totalDeadlocks: all.reduce((a, r) => a + r.deadlocked, 0),
    totalDepletions: all.reduce((a, r) => a + r.depletionEvents, 0),
    wallSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  }
  writeFileSync(join(OUT, only.length > 0 ? `bench-meta-${only.join('-')}.json` : 'bench-meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
  console.log(JSON.stringify(meta, null, 2))
}

main()
