/**
 * FMS benchmark driver.
 *
 *   npm run bench:fms                          # all sweeps, single process
 *   npm run bench:fms -- main                  # selected sweeps
 *   npm run bench:fms -- stress --jobs 10      # run on 10 worker processes
 *
 * Sweeps: main | planner | scaling | ablation | battery (seeds 1-5, the
 * original study) and stress | cascade | baselines | coupling (seeds 1-60 or
 * 1-30, added for the review round). Every run is observed tick by tick by the
 * independent TrajectoryAuditor (src/fms/sim/audit.ts), whose results are
 * stored as audit_* fields next to the simulator's own metrics.
 *
 * Writes paper/experiments/results/<sweep>.json (one record per run),
 * <sweep>.csv (same, flat) and <sweep>_summary.csv (mean/std/max per
 * configuration), plus bench-meta[-<sweeps>].json with machine and version
 * information. Results do not depend on --jobs except for wall-clock fields.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cpus, totalmem } from 'node:os'
import { execSync, fork } from 'node:child_process'
import { FleetSimulator, type SimConfig } from '../src/fms/index'
import { TrajectoryAuditor, type AuditReport } from '../src/fms/sim/audit'
import type { SimMetrics } from '../src/fms/sim/metrics'

const SEEDS = [1, 2, 3, 4, 5]
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const OUT = join(process.cwd(), 'paper/experiments/results')

type AuditFields = { [K in keyof AuditReport as `audit_${K}`]: number }
type Run = SimMetrics & AuditFields & { sweep: string; variant: string; wallMs: number }

interface Sweep {
  name: string
  seeds: number[]
  /** Throw on internal invariant violations (original sweeps) or only count them. */
  strict: boolean
  configs: Array<{ variant: string; cfg: Partial<SimConfig>; seedCfg?: (seed: number) => Partial<SimConfig> }>
}

const ALLOCS: Array<SimConfig['alloc']> = ['greedy', 'hungarian', 'pact-proxy', 'pact']
const BATTERY_STRESS: Partial<SimConfig> = {
  initialSoc: [0.2, 0.4],
  battery: { drainMove: 0.002, drainWait: 0.0004, chargeRate: 0.005, socLow: 0.2, socHigh: 0.9, reserve: 0.05 },
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
    out.push({ name: 'main', seeds: SEEDS, strict: true, configs })
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
    out.push({ name: 'planner', seeds: SEEDS, strict: true, configs })
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
    out.push({ name: 'scaling', seeds: SEEDS, strict: true, configs })
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
    out.push({ name: 'ablation', seeds: SEEDS, strict: true, configs })
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
    out.push({ name: 'battery', seeds: SEEDS, strict: true, configs })
  }
  // Safety and progress stress: 60 seeds on every layout, two fleet sizes (three
  // on small), both planner backends, both load regimes, normal and stressed
  // batteries. The allocation method rotates with the seed (seed mod 4) so every
  // method is covered without multiplying the run count. Violations are counted,
  // not thrown, so that any would be reported with its configuration.
  {
    const configs: Sweep['configs'] = []
    const fleets: Array<[string, number[], number]> = [
      ['small', [4, 6, 8], 0.3],
      ['warehouse', [16, 32], 0.15],
      ['console', [16, 24], 0.15],
      ['narrow', [8, 16], 0.15],
    ]
    for (const [layout, sizes, rate] of fleets) {
      for (const [fleet, mapf, load, battery] of grid<string | number>(sizes, ['pp', 'cbs'], ['poisson', 'batch'], ['normal', 'stress'])) {
        configs.push({
          variant: `${mapf}-${load}-${battery}`,
          cfg: {
            layout,
            fleetSize: Number(fleet),
            numTasks: 100,
            arrivalRate: load === 'batch' ? Number.POSITIVE_INFINITY : rate,
            mapf: mapf as SimConfig['mapf'],
            ...(battery === 'stress' ? BATTERY_STRESS : {}),
          },
          seedCfg: (seed) => ({ alloc: ALLOCS[seed % 4] }),
        })
      }
    }
    out.push({ name: 'stress', seeds: range(1, 60), strict: false, configs })
  }
  // Hold-cascade and priority ablation: the cascade vs. no fallback repair, vs.
  // priority restarts, vs. static priorities, on settings that exercise holds
  // (dock capacity 4 gridlocked under an earlier priority scheme).
  {
    const settings: Array<[string, Partial<SimConfig>]> = [
      ['warehouse-32', { layout: 'warehouse', fleetSize: 32, numTasks: 200 }],
      ['warehouse-32-dock4', { layout: 'warehouse', fleetSize: 32, numTasks: 200, dockCapacity: 4 }],
      ['small-8', { layout: 'small', fleetSize: 8, numTasks: 100 }],
      ['narrow-16', { layout: 'narrow', fleetSize: 16, numTasks: 200 }],
    ]
    const variants: Array<[string, Partial<SimConfig>]> = [
      ['cascade', {}],
      ['none', { fallback: 'none' }],
      ['restart', { fallback: 'restart' }],
      ['static', { priority: 'static' }],
    ]
    const configs: Sweep['configs'] = []
    for (const [setting, cfg] of settings) {
      for (const [v, vc] of variants) {
        configs.push({ variant: `${setting}/${v}`, cfg: { ...cfg, ...vc, arrivalRate: Number.POSITIVE_INFINITY, alloc: 'hungarian', mapf: 'pp' } })
      }
    }
    out.push({ name: 'cascade', seeds: range(1, 30), strict: false, configs })
  }
  // Baselines: token passing (TP) and TP with task swaps (TPTS) against the
  // rolling-horizon loop with static (Hungarian) and path-aware (PACT) costs,
  // at the default dock capacity and at capacity 1 (what TP's endpoint rule
  // amounts to for docks).
  {
    const settings: Array<[string, Partial<SimConfig>]> = [
      ['warehouse-16-batch', { layout: 'warehouse', fleetSize: 16, numTasks: 200, arrivalRate: Number.POSITIVE_INFINITY }],
      ['warehouse-32-batch', { layout: 'warehouse', fleetSize: 32, numTasks: 200, arrivalRate: Number.POSITIVE_INFINITY }],
      ['warehouse-16-poisson', { layout: 'warehouse', fleetSize: 16, numTasks: 200, arrivalRate: 0.15 }],
      ['console-16-batch', { layout: 'console', fleetSize: 16, numTasks: 200, arrivalRate: Number.POSITIVE_INFINITY }],
      ['narrow-16-batch', { layout: 'narrow', fleetSize: 16, numTasks: 200, arrivalRate: Number.POSITIVE_INFINITY }],
    ]
    const variants: Array<[string, Partial<SimConfig>]> = [
      ['tp', { coordinator: 'tp' }],
      ['tpts', { coordinator: 'tpts' }],
      ['hungarian', { alloc: 'hungarian' }],
      ['pact', { alloc: 'pact' }],
      ['hungarian-dock1', { alloc: 'hungarian', dockCapacity: 1 }],
      ['pact-dock1', { alloc: 'pact', dockCapacity: 1 }],
    ]
    const configs: Sweep['configs'] = []
    for (const [setting, cfg] of settings) {
      for (const [v, vc] of variants) configs.push({ variant: `${setting}/${v}`, cfg: { ...cfg, ...vc } })
    }
    out.push({ name: 'baselines', seeds: range(1, 30), strict: false, configs })
  }
  // Coupling regimes chosen (before running them) as the ones where path-aware
  // costs could plausibly matter: one-lane aisles, hotspot demand, long empty
  // trips, saturated chargers. Four cost models, 30 paired seeds each.
  {
    const regimes: Array<[string, Partial<SimConfig>]> = [
      ['narrow-aisles', { layout: 'narrow', fleetSize: 16, numTasks: 200, arrivalRate: Number.POSITIVE_INFINITY }],
      ['hotspot', { layout: 'warehouse', fleetSize: 32, numTasks: 200, arrivalRate: Number.POSITIVE_INFINITY, demand: 'hotspot' }],
      ['long-trips', { layout: 'warehouse', fleetSize: 24, numTasks: 200, arrivalRate: 0.1, demand: 'far' }],
      [
        'saturated-chargers',
        {
          layout: 'warehouse',
          fleetSize: 32,
          numTasks: 200,
          arrivalRate: Number.POSITIVE_INFINITY,
          initialSoc: [0.2, 0.4],
          battery: { drainMove: 0.003, drainWait: 0.0006, chargeRate: 0.005, socLow: 0.2, socHigh: 0.9, reserve: 0.05 },
        },
      ],
    ]
    const configs: Sweep['configs'] = []
    for (const [regime, cfg] of regimes) {
      for (const alloc of ALLOCS) configs.push({ variant: `${regime}/${alloc}`, cfg: { ...cfg, alloc } })
    }
    out.push({ name: 'coupling', seeds: range(1, 30), strict: false, configs })
  }
  return out
}

const NUMERIC = [
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
  'taskSwaps',
  'epochs',
  'astarCalls',
  'expansions',
  'plannerMs',
  'allocMs',
  'plannerMsPerTick',
  'utilization',
  'finalMeanSoc',
  'audit_ticks',
  'audit_robotTicks',
  'audit_vertexConflicts',
  'audit_swapConflicts',
  'audit_illegalMoves',
  'audit_depletions',
  'audit_maxNoProgress',
  'audit_maxWaitStreak',
  'audit_maxTripWaits',
  'audit_maxSlotWait',
  'audit_minSoc',
] as Array<keyof Run>

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
    const key = [r.sweep, r.layout, r.fleetSize, r.arrivalRate, r.variant, r.mapf, r.alloc].join('|')
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
      row[`${k}_max`] = Number(Math.max(...xs).toFixed(4))
    }
    rows.push(row)
  }
  return rows
}

interface Job {
  idx: number
  sweep: string
  variant: string
  strict: boolean
  cfg: Partial<SimConfig>
  seed: number
}

/** One run, observed after every tick by the independent auditor. */
function runJob(job: Job): Run {
  const w0 = performance.now()
  const sim = new FleetSimulator({ ...job.cfg, seed: job.seed, strict: job.strict })
  const auditor = new TrajectoryAuditor(sim.map, sim.cfg.battery.socLow, sim)
  while (!sim.finished) {
    sim.step()
    auditor.observe(sim)
  }
  const m = sim.metrics()
  const a = auditor.report()
  const audit = Object.fromEntries(Object.entries(a).map(([k, v]) => [`audit_${k}`, v])) as AuditFields
  return { ...m, ...audit, sweep: job.sweep, variant: job.variant, wallMs: performance.now() - w0 }
}

async function runAll(jobs: Job[], workers: number): Promise<Run[]> {
  const out: Run[] = new Array(jobs.length)
  if (workers <= 1) {
    for (const j of jobs) out[j.idx] = runJob(j)
    return out
  }
  let next = 0
  let done = 0
  await new Promise<void>((resolve, reject) => {
    for (let w = 0; w < Math.min(workers, jobs.length); w += 1) {
      const child = fork(process.argv[1], [], { env: { ...process.env, FMS_BENCH_WORKER: '1' }, serialization: 'advanced' })
      const feed = () => {
        if (next < jobs.length) child.send(jobs[next++])
        else child.disconnect()
      }
      child.on('message', (msg: Run & { idx: number }) => {
        const { idx, ...run } = msg
        out[idx] = run as Run
        done += 1
        if (done % 200 === 0) console.log(`  ${done}/${jobs.length} runs`)
        if (done === jobs.length) resolve()
        feed()
      })
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code !== 0 && code !== null) reject(new Error(`worker exited with ${code}`))
      })
      feed()
    }
  })
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const ji = args.indexOf('--jobs')
  const workers = ji >= 0 ? Number(args[ji + 1]) : 1
  const only = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1))
  mkdirSync(OUT, { recursive: true })
  const started = Date.now()
  const all: Run[] = []
  for (const sweep of sweeps()) {
    if (only.length > 0 && !only.includes(sweep.name)) continue
    const t0 = Date.now()
    const jobs: Job[] = []
    for (const { variant, cfg, seedCfg } of sweep.configs) {
      for (const seed of sweep.seeds) {
        jobs.push({ idx: jobs.length, sweep: sweep.name, variant, strict: sweep.strict, cfg: { ...cfg, ...(seedCfg ? seedCfg(seed) : {}) }, seed })
      }
    }
    console.log(`[${sweep.name}] ${jobs.length} runs on ${workers} worker(s)`)
    const runs = await runAll(jobs, workers)
    const bad = runs.filter((r) => r.conflicts + r.audit_vertexConflicts + r.audit_swapConflicts + r.audit_illegalMoves + r.deadlocked + r.depletionEvents > 0)
    console.log(
      `[${sweep.name}] done in ${((Date.now() - t0) / 1000).toFixed(0)}s; runs with a conflict, illegal move, deadlock or depletion: ${bad.length}`,
    )
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
  const sum = (k: keyof Run) => all.reduce((a, r) => a + (r[k] as number), 0)
  const meta = {
    date: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memoryGB: Number((totalmem() / 1024 ** 3).toFixed(1)),
    commit,
    workers,
    sweeps: only.length > 0 ? only : sweeps().map((s) => s.name),
    seeds: Object.fromEntries(sweeps().map((s) => [s.name, [s.seeds[0], s.seeds[s.seeds.length - 1]]])),
    runs: all.length,
    robotTicks: sum('audit_robotTicks'),
    totalConflicts: sum('conflicts'),
    auditVertexConflicts: sum('audit_vertexConflicts'),
    auditSwapConflicts: sum('audit_swapConflicts'),
    auditIllegalMoves: sum('audit_illegalMoves'),
    totalDeadlocks: sum('deadlocked'),
    totalUnfinished: sum('tasksUnfinished'),
    totalDepletions: sum('depletionEvents'),
    auditDepletions: sum('audit_depletions'),
    wallSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  }
  writeFileSync(join(OUT, only.length > 0 ? `bench-meta-${only.join('-')}.json` : 'bench-meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
  console.log(JSON.stringify(meta, null, 2))
}

if (process.env.FMS_BENCH_WORKER === '1') {
  process.on('message', (job: Job) => {
    const run = runJob(job)
    ;(process.send as (m: unknown) => void)({ ...run, idx: job.idx })
  })
} else {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
