/**
 * Number guard for the paper (paper/arxiv).
 *
 *   npm run check:paper            # exit status 1 on any mismatch
 *   npm run check:paper -- --abstract   # also print the plain-text abstract
 *
 * It checks, against the committed results in paper/experiments/results and
 * the constants in src/fms:
 *
 *  1. every generated file (tables/*.tex, figures/data/*.csv) is byte-identical
 *     to what scripts/paper-data.ts produces from the committed results;
 *  2. every <sweep>_summary.csv is the mean / std / max of <sweep>.json;
 *  3. every number written in the prose (abstract, sections, appendix, figure
 *     captions) equals the value recomputed here: each claim below is a piece
 *     of the LaTeX source built from recomputed values, and it must occur in
 *     the named file;
 *  4. coverage: after the claims and a short list of structural numerals
 *     (section-independent notation such as "4-connected") are masked, no
 *     digit may remain in the prose. A new number in the text therefore fails
 *     the guard until a claim that recomputes it is added here;
 *  5. the plain-text abstract fits arXiv's 1,920-character limit.
 *
 * Wall-clock numbers (planner ms/tick, wall seconds) are checked against the
 * committed records like any other field; they are not reproducible to the
 * digit on another host, which the paper states.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_BATTERY, DEFAULT_CONFIG, INFEASIBLE_OFFSET, POOL_FACTOR, POOL_MIN, chargerSlots, freeCellCount, loadLayout } from '../src/fms/index'
import { holm, tQuantileTwoSided, tTwoSidedP } from './stats'
import { type Paired, type Row, type Run, buildPaperData, paired, readCsv, readRuns, timingOf } from './paper-data'

const ROOT = process.cwd()
const PAPER = join(ROOT, 'paper/arxiv')
const RESULTS = join(ROOT, 'paper/experiments/results')
const failures: string[] = []
const fail = (msg: string) => failures.push(msg)
const R = String.raw

// ---------------------------------------------------------------- 1. generated files

function checkGenerated(): void {
  const { files } = buildPaperData()
  for (const [rel, content] of files) {
    const path = join(PAPER, rel)
    if (!existsSync(path)) fail(`generated file missing: ${rel}`)
    else if (readFileSync(path, 'utf8') !== content) fail(`${rel} differs from the output of scripts/paper-data.ts (run: npx tsx scripts/paper-data.ts)`)
  }
  for (const dir of ['tables', 'figures/data']) {
    for (const f of readdirSync(join(PAPER, dir))) {
      if (!files.has(`${dir}/${f}`)) fail(`${dir}/${f} is not produced by scripts/paper-data.ts`)
    }
  }
}

// ---------------------------------------------------------------- 2. summaries

const SWEEPS = ['main', 'planner', 'scaling', 'ablation', 'battery', 'stress', 'cascade', 'baselines', 'coupling', 'tpfree']
const FIRST = ['main', 'planner', 'scaling', 'ablation', 'battery']

function checkSummaries(): void {
  for (const sweep of SWEEPS) {
    const runs = readRuns(`${sweep}.json`)
    const rows = readCsv(`${sweep}_summary.csv`)
    const groups = new Map<string, Run[]>()
    for (const r of runs) {
      const rate = r.arrivalRate === null ? 'inf' : String(r.arrivalRate)
      const key = [r.layout, r.fleetSize, rate, r.variant, r.mapf, r.alloc].join('|')
      if (!groups.has(key)) groups.set(key, [])
      ;(groups.get(key) as Run[]).push(r)
    }
    if (groups.size !== rows.length) fail(`${sweep}_summary.csv: ${rows.length} rows, ${groups.size} configurations in ${sweep}.json`)
    for (const row of rows) {
      const g = groups.get([row.layout, row.fleetSize, row.arrivalRate, row.variant, row.mapf, row.alloc].join('|'))
      if (!g) {
        fail(`${sweep}_summary.csv: no runs for ${row.layout}/${row.fleetSize}/${row.arrivalRate}/${row.variant}`)
        continue
      }
      if (Number(row.n) !== g.length) fail(`${sweep}_summary.csv ${row.variant}: n=${row.n}, ${g.length} runs`)
      for (const col of Object.keys(row)) {
        const m = col.match(/^(.*)_(mean|std|max)$/)
        if (!m) continue
        const xs = g.map((r) => Number(r[m[1]]))
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length
        const v =
          m[2] === 'mean'
            ? mean
            : m[2] === 'max'
              ? Math.max(...xs)
              : xs.length > 1
                ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1))
                : 0
        if (Number(v.toFixed(4)) !== Number(row[col])) fail(`${sweep}_summary.csv ${row.layout}/${row.fleetSize}/${row.variant} ${col}: ${row[col]}, recomputed ${v.toFixed(4)}`)
      }
    }
  }
}

// ---------------------------------------------------------------- facts

const runsOf = new Map<string, Run[]>(SWEEPS.map((s) => [s, readRuns(`${s}.json`)]))
const R_ = (s: string) => runsOf.get(s) as Run[]
const summary = new Map<string, Row[]>(SWEEPS.map((s) => [s, readCsv(`${s}_summary.csv`)]))
// One meta file: all ten sweeps were written by one run of scripts/regenerate.sh.
const meta = JSON.parse(readFileSync(join(RESULTS, 'bench-meta.json'), 'utf8')) as {
  node: string
  cpu: string
  commit: string
  workers: number
  runs: number
  runsPerSweep: Record<string, number>
  seeds: Record<string, [number, number]>
}
const timing = JSON.parse(readFileSync(join(ROOT, 'paper/experiments/timing/summary.json'), 'utf8')) as {
  commit: string
  node: string
  cpu: string
  workers: number
  loadMax: number
  attempts: number
  validRepeats: number[]
  invalidRepeats: number[]
  load: Array<{ repeat: number; before: number; after: number; valid: boolean }>
  configs: Array<{ sweep: string; perRepeat: number[]; median: number; min: number; max: number }>
}
/** Reported planner ms/tick of a summary row: median over the quiet-host repeats. */
const pms = (r: Row) => (timingOf(r.sweep, r.layout, Number(r.fleetSize), r.variant) as { median: number }).median

const sum = (rs: Run[], k: string) => rs.reduce((a, r) => a + Number(r[k]), 0)
const mean = (rs: Run[], k: string) => sum(rs, k) / rs.length
const maxOf = (rs: Run[], k: string) => Math.max(...rs.map((r) => Number(r[k])))
const minOf = (rs: Run[], k: string) => Math.min(...rs.map((r) => Number(r[k])))
const ic = (x: number) => Math.round(x).toLocaleString('en-US').replace(/,/g, '{,}')
const f0 = (x: number) => x.toFixed(0)
const f1 = (x: number) => x.toFixed(1)
const f2 = (x: number) => x.toFixed(2)
const mil = (x: number) => (x / 1e6).toFixed(1)
/** Upper bound to one decimal (never rounds a bound down). */
const up1 = (x: number) => (Math.ceil(x * 10 - 1e-9) / 10).toFixed(1)
const sgn = (x: number, f: (v: number) => string = f1) => (Math.abs(x) < 0.05 ? '0.0' : `${x > 0 ? '+' : '-'}${f(Math.abs(x))}`)
/** "$+1.7\pm1.4\%$"-style body of a paired interval (without the dollars). */
/** Upper bound to two decimals (never rounds a bound down). */
const up2 = (x: number) => (Math.ceil(x * 100 - 1e-9) / 100).toFixed(2)
const s2 = (x: number) => `${x > 0 ? '+' : '-'}${f2(Math.abs(x))}`
const ci = (p: Paired) => R`${sgn(p.mean)}\pm${f1(p.half)}`
const excludesZero = (p: Paired) => p.mean - p.half > 0 || p.mean + p.half < 0
const violations = (r: Run) => Number(r.audit_vertexConflicts) + Number(r.audit_swapConflicts) + Number(r.audit_illegalMoves)

function srow(sweep: string, pred: (r: Row) => boolean): Row {
  const hit = (summary.get(sweep) as Row[]).filter(pred)
  if (hit.length !== 1) throw new Error(`${sweep}_summary.csv: ${hit.length} rows match`)
  return hit[0]
}
const n = (r: Row, k: string) => Number(r[k])
const METHODS = ['greedy', 'hungarian', 'pact-proxy', 'pact']
const mainRow = (layout: string, rate: string, fleet: number, variant: string) =>
  srow('main', (r) => r.layout === layout && r.arrivalRate === rate && Number(r.fleetSize) === fleet && r.variant === variant)
const abl = (variant: string) => srow('ablation', (r) => r.variant === variant)
const scal = (fleet: number, variant: string) => srow('scaling', (r) => Number(r.fleetSize) === fleet && r.variant === variant)
const plan = (fleet: number, variant: string) => srow('planner', (r) => Number(r.fleetSize) === fleet && r.variant === variant)
const batt = (variant: string) => srow('battery', (r) => r.variant === variant)
const rateKey = (r: Run) => (r.arrivalRate === null ? 'inf' : String(r.arrivalRate))
const byVariant = (sweep: string, variant: string) => R_(sweep).filter((r) => r.variant === variant)

// First round and stress totals.
const first = FIRST.flatMap((s) => R_(s))
const stress = R_('stress')
const firstAndStress = [...first, ...stress]
const stressNormal = stress.filter((r) => String(r.variant).endsWith('normal'))
const stressDrain = stress.filter((r) => String(r.variant).endsWith('stress'))

// Main table: spread of the four cost models per cell.
const CELLS: Array<[string, string, number]> = []
for (const layout of ['warehouse', 'console']) for (const rate of ['0.15', 'inf']) for (const fleet of [8, 16, 32]) CELLS.push([layout, rate, fleet])
const cellSpread = CELLS.map(([l, r, fl]) => {
  const t = METHODS.map((m) => n(mainRow(l, r, fl, m), 'throughput_mean'))
  return (100 * (Math.max(...t) - Math.min(...t))) / Math.max(...t)
})
const maxSpread = Math.max(...cellSpread)
const worstCell = CELLS[cellSpread.indexOf(maxSpread)]
const mainSel = (l: string, r: string, fl: number, alloc: string) => R_('main').filter((x) => x.layout === l && rateKey(x) === r && x.fleetSize === fl && x.alloc === alloc)
const mainPaired: Array<{ cell: [string, string, number]; method: string; p: Paired }> = []
for (const c of CELLS) for (const m of ['greedy', 'pact-proxy', 'pact']) mainPaired.push({ cell: c, method: m, p: paired(mainSel(c[0], c[1], c[2], m), mainSel(c[0], c[1], c[2], 'hungarian'), 'throughput') })
const mainExcl = mainPaired.filter((x) => excludesZero(x.p))
const bound = (p: Paired) => Math.max(Math.abs(p.mean - p.half), Math.abs(p.mean + p.half))
const worstBatch = Math.max(...mainPaired.filter((x) => x.cell[1] === 'inf').map((x) => bound(x.p)))
const worstPoisson = Math.max(...mainPaired.filter((x) => x.cell[1] !== 'inf').map((x) => bound(x.p)))

// Warehouse / 32 robots / batch, the reference configuration of the ablations.
const W32 = (m: string) => mainRow('warehouse', 'inf', 32, m)
const w32 = METHODS.map(W32)
const pactDefault = abl('pact')
const hungMain = mainSel('warehouse', 'inf', 32, 'hungarian')
const ablRuns = (v: string) => byVariant('ablation', v)
const dockGainPact = 100 * (n(W32('pact'), 'throughput_mean') / n(abl('pact-dock2'), 'throughput_mean') - 1)
const dockGainHung = 100 * (n(W32('hungarian'), 'throughput_mean') / n(abl('hungarian-dock2'), 'throughput_mean') - 1)
const w10Gain = 100 * (n(abl('pact-w10'), 'throughput_mean') / n(pactDefault, 'throughput_mean') - 1)
const w30Gain = 100 * (n(abl('pact-w30'), 'throughput_mean') / n(pactDefault, 'throughput_mean') - 1)
const pW10 = paired(ablRuns('pact-w10'), ablRuns('pact'), 'throughput')
const pW30 = paired(ablRuns('pact-w30'), ablRuns('pact'), 'throughput')
const pDock2P = paired(ablRuns('pact-dock2'), ablRuns('pact'), 'throughput')
const pDock2H = paired(ablRuns('hungarian-dock2'), hungMain, 'throughput')
const pNoEvP = paired(ablRuns('pact-noEvent'), ablRuns('pact'), 'throughput')
const pNoEvH = paired(ablRuns('hungarian-noEvent'), hungMain, 'throughput')

// Holm's procedure over the fourteen lever and planner comparisons (as in tables/paired.tex).
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen']
const word = (k: number) => WORDS[k]
const Word = (k: number) => WORDS[k][0].toUpperCase() + WORDS[k].slice(1)
const eptOf = (r: Row) => n(r, 'expansions_mean') / n(r, 'makespan_mean')
const eptRuns = (rs: Run[]) => rs.reduce((a, r) => a + Number(r.expansions) / Number(r.makespan), 0) / rs.length
const pH1 = paired(ablRuns('pact-h1'), ablRuns('pact'), 'throughput')
const pNoBatP = paired(ablRuns('pact-noBattery'), ablRuns('pact'), 'throughput')
const pNoBatH = paired(ablRuns('hungarian-noBattery'), hungMain, 'throughput')
const pK3 = paired(ablRuns('pact-K3'), ablRuns('pact'), 'throughput')
const pK12 = paired(ablRuns('pact-K12'), ablRuns('pact'), 'throughput')

// Planner sweep (small layout) and CBS in the stress sweep.
const cbsMakespan = [4, 6, 8].map((fl) => 100 * (n(plan(fl, 'cbs'), 'makespan_mean') / n(plan(fl, 'pp'), 'makespan_mean') - 1))
const cbsWaits = [4, 6, 8].map((fl) => 100 * (n(plan(fl, 'cbs'), 'waitActions_mean') / n(plan(fl, 'pp'), 'waitActions_mean') - 1))
const cbsService = [4, 6, 8].map((fl) => 100 * (n(plan(fl, 'cbs'), 'meanServiceTime_mean') / n(plan(fl, 'pp'), 'meanServiceTime_mean') - 1))
const cbsPaired = [4, 6, 8].map((fl) => {
  const sel = (m: string) => R_('planner').filter((r) => r.fleetSize === fl && r.mapf === m)
  return paired(sel('cbs'), sel('pp'), 'makespan')
})
const STRESS_CFG: Array<[string, number]> = [
  ['small', 4],
  ['small', 6],
  ['small', 8],
  ['warehouse', 16],
  ['warehouse', 32],
  ['console', 16],
  ['console', 24],
  ['narrow', 8],
  ['narrow', 16],
]
const cbsStress = STRESS_CFG.map(([layout, fleet]) => {
  const pick = (m: string) => stressNormal.filter((r) => r.layout === layout && r.fleetSize === fleet && r.mapf === m)
  const key = (r: Run) => `${r.seed}|${r.arrivalRate}`
  const pp = new Map(pick('pp').map((r) => [key(r), r]))
  const cbs = pick('cbs')
  const rel = cbs.map((r) => (100 * (Number(r.makespan) - Number((pp.get(key(r)) as Run).makespan))) / Number((pp.get(key(r)) as Run).makespan))
  const m = rel.reduce((a, b) => a + b, 0) / rel.length
  const sd = Math.sqrt(rel.reduce((a, b) => a + (b - m) ** 2, 0) / (rel.length - 1))
  if (rel.length !== 120) throw new Error('stress CBS pairs')
  return {
    layout,
    fleet,
    pairs: rel.length,
    mean: m,
    half: (1.98 * sd) / Math.sqrt(rel.length),
    fallbacks: mean(cbs, 'cbsFallbacks'),
    epochs: mean(cbs, 'epochs'),
    ratio: mean(cbs, 'plannerMsPerTick') / mean(pick('pp'), 'plannerMsPerTick'),
  }
})
const leverFamily: Array<[string, Paired]> = [
  ['w10', pW10], ['w30', pW30], ['dock2P', pDock2P], ['dock2H', pDock2H], ['noEvP', pNoEvP], ['noEvH', pNoEvH], ['h1', pH1],
  ['noBatP', pNoBatP], ['noBatH', pNoBatH], ['K3', pK3], ['K12', pK12], ['cbs4', cbsPaired[0]], ['cbs6', cbsPaired[1]], ['cbs8', cbsPaired[2]],
]
const leverHolm = holm(leverFamily.map(([, x]) => x.p))
const leverSurvivors = leverFamily.filter((_, i) => leverHolm[i]).map(([k]) => k)
// CBS against PP in the stress sweep, split by load (60 seed pairs each).
const cbsSplit = STRESS_CFG.map(([layout, fleet]) => {
  const pick = (m: string, load: string) => stressNormal.filter((r) => r.layout === layout && r.fleetSize === fleet && r.mapf === m && String(r.variant).includes(load))
  return {
    layout,
    fleet,
    batch: paired(pick('cbs', 'batch'), pick('pp', 'batch'), 'makespan'),
    poisson: paired(pick('cbs', 'poisson'), pick('pp', 'poisson'), 'makespan'),
    expBatch: eptRuns(pick('cbs', 'batch')) / eptRuns(pick('pp', 'batch')),
  }
})
const splitBig = cbsSplit.filter((x) => x.layout !== 'small')
const cbsBig = cbsStress.filter((x) => x.layout !== 'small')
const cbsSmall = cbsStress.filter((x) => x.layout === 'small')
const cbsAt = (layout: string, fleet: number) => cbsStress.find((x) => x.layout === layout && x.fleet === fleet) as (typeof cbsStress)[number]
const stressCbs = stress.filter((r) => r.mapf === 'cbs')

// Reserve table (Proposition 2).
const reserveFactors = ['small', 'warehouse', 'console', 'narrow'].map((layout) => {
  const rs = stressNormal.filter((r) => r.layout === layout)
  const map = loadLayout(layout)
  // Largest free-space distance from any free cell to any slot, by BFS from each slot.
  let D = 0
  for (const s of chargerSlots(map)) {
    const dist = new Int32Array(map.width * map.height).fill(-1)
    const q = [s]
    dist[s] = 0
    for (let h = 0; h < q.length; h += 1) {
      const c = q[h]
      const x = c % map.width
      const y = Math.floor(c / map.width)
      for (const [nx, ny] of [
        [x, y - 1],
        [x - 1, y],
        [x + 1, y],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue
        const nc = ny * map.width + nx
        if (map.blocked[nc] === 1 || dist[nc] >= 0) continue
        dist[nc] = dist[c] + 1
        D = Math.max(D, dist[nc])
        q.push(nc)
      }
    }
  }
  const Wd = maxOf(rs, 'audit_maxWorkTripDelay')
  const Q = maxOf(rs, 'audit_maxSlotWait')
  const rho = DEFAULT_BATTERY.drainMove * (3 * Wd + Q + D) + 2 * DEFAULT_BATTERY.drainWait * DEFAULT_CONFIG.dwell
  const rho0 = DEFAULT_BATTERY.drainMove * D + 2 * DEFAULT_BATTERY.drainWait * DEFAULT_CONFIG.dwell
  const covered = rs.filter(
    (r) =>
      DEFAULT_BATTERY.reserve > DEFAULT_BATTERY.drainMove * (3 * Number(r.audit_maxWorkTripDelay) + Number(r.audit_maxSlotWait) + D) + 2 * DEFAULT_BATTERY.drainWait * DEFAULT_CONFIG.dwell &&
      DEFAULT_BATTERY.socLow > DEFAULT_BATTERY.drainMove * (1 + Number(r.audit_maxWorkTripDelay) + Number(r.audit_maxSlotWait) + D),
  ).length
  return { layout, factor: rho / DEFAULT_BATTERY.reserve, zeroOk: rho0 < DEFAULT_BATTERY.reserve, covered }
})

// Cascade sweep.
const CASC = ['warehouse-32', 'warehouse-32-dock4', 'small-8', 'narrow-16']
const casc = (setting: string, v: string) => byVariant('cascade', `${setting}/${v}`)
const withConflict = (rs: Run[]) => rs.filter((r) => violations(r) > 0).length
const cascThr = (s: string) => ['cascade', 'none', 'restart'].map((v) => mean(casc(s, v), 'throughput'))
const cascSpread = Math.max(...CASC.map((s) => Math.max(...cascThr(s)) - Math.min(...cascThr(s))))
const pDock4 = paired(casc('warehouse-32-dock4', 'cascade'), casc('warehouse-32', 'cascade'), 'throughput')
const staticStalled = CASC.map((s) => sum(casc(s, 'static'), 'deadlocked'))
const cascPair = (s: string, v: string) => paired(casc(s, v), casc(s, 'cascade'), 'throughput')
const cascFamily: Array<[string, Paired]> = CASC.flatMap((s) => ['none', 'restart'].map((v) => [`${s}/${v}`, cascPair(s, v)] as [string, Paired]))
const cascHolm = holm(cascFamily.map(([, x]) => x.p))

// Baselines sweep.
const BASE = ['warehouse-16-batch', 'warehouse-32-batch', 'warehouse-16-poisson', 'console-16-batch', 'narrow-16-batch']
const base = (s: string, v: string) => byVariant('baselines', `${s}/${v}`)
const vsHung = (v: string) => BASE.map((s) => paired(base(s, v), base(s, 'hungarian'), 'throughput'))
const vsDock1 = (v: string) => BASE.map((s) => paired(base(s, v), base(s, 'hungarian-dock1'), 'throughput'))
const means = (ps: Paired[]) => ps.map((p) => p.mean)
const tpVsH = means(vsHung('tp'))
const tptsVsH = means(vsHung('tpts'))
const tpVs1 = means(vsDock1('tp'))
const tptsVs1 = means(vsDock1('tpts'))
const pactVsH = vsHung('pact')
const pactVs1 = vsDock1('pact-dock1')
const tpRuns = BASE.flatMap((s) => [...base(s, 'tp'), ...base(s, 'tpts')])
const astar = (v: string) => BASE.map((s) => mean(base(s, v), 'astarCalls'))
const rhAstar = [...astar('hungarian'), ...astar('pact')]
const lessLo = Math.min(...[...tpVsH, ...tptsVsH].map(Math.abs))
const lessHi = Math.max(...[...tpVsH, ...tptsVsH].map(Math.abs))

// Coupling sweep.
const coup = (reg: string, m: string) => byVariant('coupling', `${reg}/${m}`)
const cp = (reg: string, a: string, b: string, k: string) => paired(coup(reg, a), coup(reg, b), k)
const SAFE = ['narrow-aisles', 'hotspot', 'long-trips']
const pactSafe = SAFE.flatMap((reg) => ['hungarian', 'greedy'].flatMap((b) => ['throughput', 'meanServiceTime'].map((k) => ({ reg, b, k, p: cp(reg, 'pact', b, k) }))))
const proxySafe = SAFE.flatMap((reg) => ['hungarian', 'greedy'].flatMap((b) => ['throughput', 'meanServiceTime'].map((k) => ({ reg, b, k, p: cp(reg, 'pact-proxy', b, k) }))))
const proxyExcl = proxySafe.filter((x) => excludesZero(x.p))
const SAT = 'saturated-chargers'
const satDepl = METHODS.map((m) => sum(coup(SAT, m), 'depletionEvents'))
const satStall = METHODS.map((m) => sum(coup(SAT, m), 'deadlocked'))

// Layout table.
const layoutRow = (name: string) => {
  const map = loadLayout(name)
  return { map, size: R`$${map.width}\times${map.height}$`, free: freeCellCount(map), pickups: map.pickups.length, docks: map.deliveries.length, slots: chargerSlots(map).length, stations: map.chargers.length, homes: map.homes.length }
}
const LW = layoutRow('warehouse')
const LC = layoutRow('console')
const LS = layoutRow('small')
const LN = layoutRow('narrow')
const site = JSON.parse(readFileSync(join(ROOT, 'src/fms/map/console_site.json'), 'utf8')) as { zones: Record<string, { lines: number; docks: number }> }
const zoneLines = ['A', 'B', 'C', 'D'].map((z) => site.zones[z].lines)
const siteDocks = Object.values(site.zones).reduce((a, z) => a + z.docks, 0)

// Per-run record schema and test count.
const recordKeys = Object.keys(R_('stress')[0])
const auditKeys = recordKeys.filter((k) => k.startsWith('audit_'))
const extraKeys = ['sweep', 'variant', 'wallMs']
const metricKeys = recordKeys.filter((k) => !k.startsWith('audit_') && !extraKeys.includes(k))
const CONFIG_KEYS = ['layout', 'fleetSize', 'numTasks', 'arrivalRate', 'seed', 'alloc', 'mapf', 'window', 'period', 'wBattery']
// Comparison made by scripts/regenerate.sh before it replaced the records.
const regen = JSON.parse(readFileSync(join(ROOT, 'paper/experiments/repro/regeneration.json'), 'utf8')) as {
  commit: string
  records: number
  differingFields: number
  sweepsWithoutCommittedFile: string[]
  sweeps: Array<{ sweep: string; records: number; differingFields: number }>
}
const secondRuns = SWEEPS.filter((x) => !FIRST.includes(x)).reduce((a, x) => a + meta.runsPerSweep[x], 0)

// Coupling diagnostics (cpl* counters), pooled over the runs of a configuration.
const diag = (rs: Run[]) => ({
  beyond: (100 * sum(rs, 'cplPairsBeyond')) / sum(rs, 'cplPairs'),
  differ: (100 * sum(rs, 'cplPairsDiffer')) / sum(rs, 'cplPairs'),
  gap: sum(rs, 'cplGapSum') / sum(rs, 'cplPairsDiffer'),
  dbar: sum(rs, 'cplDistSum') / sum(rs, 'cplPairs'),
  match: (100 * sum(rs, 'cplAllocsMatchDiffer')) / sum(rs, 'cplAllocs'),
})
const diagCells = CELLS.map((c) => diag(mainSel(c[0], c[1], c[2], 'pact')))
const diagCellsProxy = CELLS.map((c) => diag(mainSel(c[0], c[1], c[2], 'pact-proxy')))
const diagReg = (reg: string) => diag(byVariant('coupling', `${reg}/pact`))
const rng0 = (xs: number[]) => `${f0(Math.min(...xs))}--${f0(Math.max(...xs))}`
const rng1 = (xs: number[]) => `${f1(Math.min(...xs))}--${f1(Math.max(...xs))}`
const cellMatch = rng0(diagCells.map((x) => x.match))
const cellBeyond = rng0(diagCells.map((x) => x.beyond))
const cellDiffer = rng0(diagCells.map((x) => x.differ))
const cellGap = rng1(diagCells.map((x) => x.gap))
const REGIMES = ['narrow-aisles', 'hotspot', 'long-trips', 'saturated-chargers']
const regMatch = REGIMES.map((x) => diagReg(x).match)

// Token-passing variants (tpfree sweep) against the home variant and the loop at one robot per dock.
const tf = (s: string, v: string) => (v === 'tp' || v === 'tpts' ? base(s, v) : byVariant('tpfree', `${s}/${v}`))
const tfVsHome = (v: string, home: string) => BASE.map((s) => paired(tf(s, v), base(s, home), 'throughput'))
const tfVsRh1 = (v: string) => BASE.map((s) => paired(tf(s, v), base(s, 'hungarian-dock1'), 'throughput'))
const tfVsRh3 = (v: string) => BASE.map((s) => paired(tf(s, v), base(s, 'hungarian'), 'throughput'))
const tpMove = Math.max(...[...tfVsHome('tp-interruptible', 'tp'), ...tfVsHome('tp-faithful', 'tp')].map((x) => Math.abs(x.mean)))
const intHome = tfVsHome('tpts-interruptible', 'tpts')
const intRh = tfVsRh1('tpts-interruptible')
const faiHome = tfVsHome('tpts-faithful', 'tpts')
const faiRh = tfVsRh1('tpts-faithful')
const tptsAllRh = [...tfVsRh1('tpts'), ...intRh, ...faiRh].map((x) => x.mean)
// Wording shared by the abstract, introduction and conclusion: the best variant against the loop, and the adapted published rule.
const intMore = rng1(intRh.map((x) => x.mean))
const faiBelow = f1(Math.abs(Math.min(...faiRh.map((x) => x.mean))))
const faiAbove = f1(Math.max(...faiRh.map((x) => x.mean)))
// Holm over the ten intervals of TPTS (home and interruptible variants) against the loop at one robot per dock.
const tptsFamily = [...tfVsRh1('tpts'), ...intRh]
const tptsHolm = holm(tptsFamily.map((x) => x.p))
const tptsFamily15 = [...tptsFamily, ...faiRh]
const tptsHolm15 = holm(tptsFamily15.map((x) => x.p))
const f3 = (x: number) => x.toFixed(3)
const tptsBehind3 = Math.min(...['tpts', 'tpts-interruptible', 'tpts-faithful'].flatMap((v) => tfVsRh3(v).map((x) => Math.abs(x.mean + (x.mean < 0 ? x.half : -x.half)))))
const tfRuns = R_('tpfree')

// ---------------------------------------------------------------- 3. claims

interface FileSpec {
  file: string
  /** 'all': every digit; 'nomath': digits outside math and algorithms; 'caption': digits inside \caption{...}. */
  mode: 'all' | 'nomath' | 'caption'
  claims: string[]
  /** Numerals that are notation, not results. */
  structural: string[]
  /** Formulas built from constants of src/fms that must occur (they sit in math, which 'nomath' does not scan). */
  always?: string[]
  /** Pin every formula and algorithm line that holds a digit to the reviewed snapshot. */
  pinMath?: boolean
}

function assert(cond: boolean, msg: string): void {
  if (!cond) fail(`assertion failed: ${msg}`)
}

function specs(): FileSpec[] {
  const out: FileSpec[] = []
  const lessRange = `${f0(lessLo)}--${f0(lessHi)}`
  const cbsSmallRange = `${f0(Math.min(...cbsSmall.map((x) => Math.abs(x.mean))))}--${f0(Math.max(...cbsSmall.map((x) => Math.abs(x.mean))))}`
  const steps = mil(sum(firstAndStress, 'audit_robotTicks'))
  assert(firstAndStress.reduce((a, r) => a + violations(r), 0) === 0, 'no audited conflict or illegal move in first round + stress')
  assert(sum(firstAndStress, 'conflicts') === 0, 'no simulator-counted conflict in first round + stress')
  assert(CELLS.length === 12, 'twelve cells in the main table')
  assert(f0(Math.abs(w10Gain)) === '7' && f0(Math.abs(w30Gain)) === '7', 'window changes throughput by 7% either way')
  assert(sum(stressNormal, 'depletionEvents') === 0 && sum(stressNormal, 'tasksUnfinished') === 0 && sum(stressNormal, 'deadlocked') === 0, 'normal batteries: no depletion, stall or unfinished task')
  assert(sum(first, 'depletionEvents') === 0 && sum(first, 'tasksUnfinished') === 0 && sum(first, 'deadlocked') === 0, 'first round: no depletion, stall or unfinished task')
  const drainShare = stressDrain.filter((r) => Number(r.depletionEvents) > 0).length / stressDrain.length
  assert(drainShare > 0.62 && drainShare < 0.72, 'doubled drain strands robots in about two thirds of the runs')
  assert(cascConflictRuns('none').every((x) => x > 0), 'without repair, conflicts in every setting')
  assert(staticStalled.every((x) => x > 0), 'static priorities stall runs in every setting')
  assert(SAFE.every((reg) => !excludesZero(cp(reg, 'pact', 'greedy', 'throughput')) && !excludesZero(cp(reg, 'pact', 'hungarian', 'throughput'))), 'PACT: no resolved throughput gain in the three safe regimes')
  assert(!excludesZero(cp(SAT, 'pact', 'greedy', 'throughput')) && excludesZero(cp(SAT, 'pact', 'hungarian', 'throughput')), 'saturated chargers: PACT resolved against Hungarian only')

  out.push({
    file: 'sections/0_abstract.tex',
    mode: 'all',
    claims: [
      R`in ${ic(firstAndStress.length)} runs with ${steps} million`,
      R`on ${word(new Set(firstAndStress.map((r) => r.layout)).size)} synthetic layouts`,
      R`in all ${word(CELLS.length)} layout/fleet/load cells`,
      R`with doubled drain the charging policy strands robots in two thirds of runs`,
      R`within ${f1(maxSpread)}\% of each other`,
      R`changes the matching in only ${cellMatch}\% of the allocations, since`,
      R`beats our loop by ${intMore}\% in every setting`,
      R`ranges from ${faiBelow}\% below to ${faiAbove}\% above by setting`,
    ],
    structural: [],
  })
  assert(Math.min(...diagCells.map((x) => x.beyond)) > 50, 'most priced pickups lie beyond the window in every cell')

  assert(['w10', 'dock2P', 'dock2H', 'cbs6'].join() === [...leverSurvivors].sort((a, b) => ['w10', 'dock2P', 'dock2H', 'cbs6'].indexOf(a) - ['w10', 'dock2P', 'dock2H', 'cbs6'].indexOf(b)).join(), 'Holm survivors: window 10, dock capacity (both cost models), CBS at 6 robots')
  assert(Math.abs(tTwoSidedP(2.776, 4) - 0.05) < 2e-4 && Math.abs(tQuantileTwoSided(0.05, 29) - 2.045) < 1e-3, 't distribution agrees with tabulated quantiles')
  assert(cbsSmall.every((x) => x.pairs === 120 && x.mean + x.half < 0), 'CBS gain on small resolved on 120 pairs')
  out.push({
    file: 'sections/1_introduction.tex',
    mode: 'all',
    claims: [
      R`${first.length} seeded runs on ${word(new Set(first.map((r) => r.layout)).size)} layouts`,
      R`in every one of ${word(CELLS.length)} layout/fleet/load cells the ${word(METHODS.length)} allocation cost models`,
      R`With ${word(meta.seeds.main[1])} seeds the interval`,
      R`a second round of ${ic(secondRuns)} runs adds a ${meta.seeds.stress[1]}-seed safety stress`,
      R`baselines under ${word(3)} rules for idle robots`,
      R`in only ${cellMatch}\% of the allocations, because ${cellBeyond}\% of the priced pickups lie beyond`,
      R`the matching changes in ${rng0(regMatch)}\% of the allocations`,
      R`delivers ${intMore}\% more than our loop in every setting`,
      R`ranges from ${faiBelow}\% below to ${faiAbove}\% above across the ${word(faiRh.length)} settings`,
      R`our loop is slightly behind the best token-passing variant`,
      R`differ by at most ${f1(maxSpread)}\% in`,
      R`${mainPaired.length - mainExcl.length} of ${mainPaired.length} seed-paired 95\% intervals`,
      R`reach about ${f0(worstBatch)}\% in the noisiest cell and about ${f0(worstPoisson)}\% under the Poisson`,
      R`capacity from 2 to ${DEFAULT_CONFIG.dockCapacity} raises throughput by ${f0(Math.min(dockGainPact, dockGainHung))}--${f0(Math.max(dockGainPact, dockGainHung))}\%`,
      R`window from ${DEFAULT_CONFIG.window} to 10 ticks raises it by ${f0(w10Gain)}\% while`,
      R`A* expansions per tick by ${f0(100 * (1 - eptOf(abl('pact-w10')) / eptOf(pactDefault)))}\%`,
      R`makespan by ${cbsSmallRange}\% on the small layout`,
      R`${word(leverFamily.length)} lever and planner comparisons of the first round`,
      R`${cbsSmall[0].pairs} seed pairs per fleet size`,
      R`deliver ${lessRange}\% less throughput`,
      R`${steps} million audited robot-steps`,
    ],
    structural: [],
  })
  assert(new Set(first.map((r) => r.layout)).size === 3, 'first round covers three layouts')

  out.push({ file: 'sections/2_related_works.tex', mode: 'all', claims: [], structural: [] })

  out.push({
    file: 'sections/3_method.tex',
    mode: 'nomath',
    claims: [
      R`$\rho=${DEFAULT_BATTERY.reserve}$ is short of`,
      R`by a factor of ${f1(Math.min(...reserveFactors.map((x) => x.factor)))} to ${f1(Math.max(...reserveFactors.map((x) => x.factor)))} on`,
      R`not one of the ${ic(stressNormal.length)} normal-battery runs`,
      R`it would suffice only on the small layout`,
    ],
    structural: ['4-connected', '4-neighbour', 'group~1', 'group~2', 'Group~1'],
    always: [R`the oldest $\max(${POOL_FACTOR}m,${POOL_MIN})$ such tasks`, R`(the implementation uses $S+10^${Math.log10(INFEASIBLE_OFFSET)}$)`],
    pinMath: true,
  })
  assert(reserveFactors.every((x) => x.covered === 0), 'no normal-battery run satisfies eq. (reserve)')
  assert(reserveFactors.filter((x) => x.zeroOk).map((x) => x.layout).join() === 'small', 'W=Q=0 suffices only on small')

  out.push(experiments())

  const w32svc = w32.map((r) => n(r, 'meanServiceTime_mean'))
  const w32queue = w32.map((r) => n(r, 'meanWaitTime_mean'))
  const w32exec = w32.map((r) => n(r, 'meanExecTime_mean'))
  const pactHalf = pactSafe.map((x) => x.p.half)
  out.push({
    file: 'sections/5_discussion.tex',
    mode: 'all',
    claims: [
      R`with 32 robots, service time is ${f0(Math.min(...w32svc))}--${f0(Math.max(...w32svc))} ticks of which ${f0(Math.min(...w32queue))}--${f0(Math.max(...w32queue))} are queueing`,
      R`the remaining ${f0(Math.min(...w32exec))} ticks or so`,
      R`a run of ${DEFAULT_CONFIG.numTasks} tasks executes ${f0(n(W32('pact'), 'waitActions_mean'))} wait actions against ${f1(n(W32('pact'), 'moveActions_mean') / 1000)} thousand moves, about ${f1(n(W32('pact'), 'waitActions_mean') / DEFAULT_CONFIG.numTasks)} waits per task`,
      R`half-widths of ${f1(Math.min(...pactHalf))} to ${f1(Math.max(...pactHalf))}\%`,
      R`fleets of at most ${maxOf(first, 'fleetSize')} robots`,
      R`runs at ${f2(pms(scal(4, 'hungarian')))}--${f2(pms(scal(48, 'pact')))} ms of planner time per simulated tick for 4 to 48 robots`,
      R`($+${f0(100 * (n(scal(48, 'pact'), 'astarCalls_mean') / n(scal(48, 'hungarian'), 'astarCalls_mean') - 1))}\%$ at 48 robots)`,
      R`costs ${f2(Math.min(...[4, 6, 8].map((fl) => pms(plan(fl, 'cbs')))))}--${f2(Math.max(...[4, 6, 8].map((fl) => pms(plan(fl, 'cbs')))))} ms/tick`,
      R`gridlocks in ${staticStalled.reduce((a, b) => a + b, 0)} of ${CASC.length * 30} runs`,
      R`from ${DEFAULT_CONFIG.dockCapacity} to 2 robots per dock costs a fifth of the throughput, and loosening it to 4 gains ${f0(pDock4.mean)}\% at more than twice the`,
      R`the second round uses ${meta.seeds.cascade[1]} to ${meta.seeds.stress[1]} seeds`,
      R`groups of up to ${maxOf(stressCbs, 'fleetSize')} robots`,
      R`gains only ${f0(Math.min(...splitBig.map((x) => Math.abs(x.batch.mean))))}--${f0(Math.max(...splitBig.map((x) => Math.abs(x.batch.mean))))}\% makespan there under batch load`,
      R`for ${cellDiffer}\% of the priced pairs, by ${cellGap} ticks on average, and changes the matching in ${cellMatch}\% of the allocations; most pickups (${cellBeyond}\%)`,
      R`(${f0(diagReg('hotspot').match)}\% of the allocations), and there too every interval`,
      R`(medians of ${word(timing.validRepeats.length)} repeats`,
      ...limitationClaims(),
    ],
    structural: [R`A^{\mathcal{B}}(p^r,p_\tau,t_0)`, '4-connected', '2-wide aisles'],
  })
  assert(Math.abs(pDock2P.mean) > 18 && Math.abs(pDock2H.mean) < 24, 'dock capacity 2 costs about a fifth')
  assert(mean(casc('warehouse-32-dock4', 'cascade'), 'holdEvents') > 2 * mean(casc('warehouse-32', 'cascade'), 'holdEvents'), 'capacity 4 needs more than twice the holds')
  assert(pms(scal(48, 'pact')) < 1, 'planner stays below 1 ms per tick')

  out.push({
    file: 'sections/6_conclusion.tex',
    mode: 'all',
    claims: [
      R`in ${ic(firstAndStress.length)} seeded runs with ${steps} million`,
      R`fleets of ${minOf(firstAndStress, 'fleetSize')} to ${maxOf(firstAndStress, 'fleetSize')} robots`,
      R`by ${f0(Math.abs(w10Gain))}--${f0(Math.max(dockGainPact, dockGainHung))}\%`,
      R`shortened the makespan by ${cbsSmallRange}\%`,
      R`across ${word(new Set(firstAndStress.map((r) => r.layout)).size)} layouts`,
      R`neither in the ${word(CELLS.length)} cells of the main study`,
      R`delivered ${lessRange}\% less`,
      R`delivered ${intMore}\%
more than our loop in every setting`,
      R`it ranged from ${faiBelow}\% below to ${faiAbove}\% above across the ${word(faiRh.length)} settings`,
      R`in only ${cellMatch}\% of the allocations of the main study; only under hotspot demand did it reach ${f0(diagReg('hotspot').match)}\%`,
    ],
    structural: [],
  })
  assert(new Set(firstAndStress.map((r) => r.layout)).size === 4, 'four layouts audited')

  out.push(appendix())

  out.push({ file: 'figures/overview.tex', mode: 'caption', claims: [], structural: [] })
  out.push({ file: 'figures/planner.tex', mode: 'caption', claims: [R`on the warehouse with 32 robots`, R`is scaled by 10 to share the axis`, R`y expr=10*\thisrow{plannerMs_median}`, R`median of ${word(timing.validRepeats.length)} repeats`], structural: [] })
  out.push({
    file: 'figures/scaling.tex',
    mode: 'caption',
    claims: [R`(${DEFAULT_CONFIG.numTasks} tasks, mean\stdv{std} over ${meta.seeds.scaling[1]} seeds;`, R`($${LW.docks}$ docks $\times\,\kappa_{\mathrm{d}}{=}${DEFAULT_CONFIG.dockCapacity}$)`, R`up to 32 robots`, R`median of ${word(timing.validRepeats.length)} repeats`],
    structural: [],
  })
  return out
}

function cascConflictRuns(v: string): number[] {
  return CASC.map((s) => withConflict(casc(s, v)))
}

function limitationClaims(): string[] {
  const makespans = firstAndStress.map((r) => Number(r.makespan))
  return [
    R`delivers ${minOf(firstAndStress, 'numTasks')} or ${maxOf(firstAndStress, 'numTasks')} tasks`,
    R`ends within ${ic(Math.max(...makespans))} ticks`,
    R`of at most ${Math.max(LW.free, LC.free, LS.free, LN.free)} free cells`,
    R`Node.js~${String(meta.node).replace(/^v(\d+)\..*$/, '$1')}`,
  ]
}

function experiments(): FileSpec {
  const c: string[] = []
  const B = DEFAULT_BATTERY
  const stressBattery = { move: 2 * B.drainMove, wait: 2 * B.drainWait }
  // Setup.
  c.push(
    R`adds a ${meta.seeds.stress[1]}-seed stress sweep`,
    R`(${LW.size}, ${LW.free} free cells) has four blocks of five 10-cell shelf lines with 2-wide aisles, ${LW.pickups} pickup points, ${LW.docks} docks, ${LW.stations} charger stations of ${LW.slots / LW.stations} slots and ${LW.homes} home bays`,
    R`(${LC.size}, ${LC.free} free cells)`,
    R`(zones A--D with ${zoneLines[0]}, ${zoneLines[1]}, ${zoneLines[2]} and ${zoneLines[3]} shelf lines;`,
    R`${LC.pickups} pickups, ${LC.docks} docks, ${LC.stations} stations, ${LC.homes} bays`,
    R`(${LS.size}, ${LS.free} free cells) is an open floor with ${LS.pickups} pickups, ${LS.docks} docks, ${LS.slots} slots and ${LS.homes} bays`,
    R`(${LN.size}, ${LN.free} free cells)`,
    R`${LN.pickups} pickups, ${LN.docks} docks, ${LN.slots} slots, ${LN.homes} bays`,
    R`Each run delivers ${DEFAULT_CONFIG.numTasks} tasks (100 on \emph{small}, and ${maxOf(stress, 'numTasks')} on every layout in the stress sweep)`,
    R`$\lambda=0.15$ tasks per tick, which is below the capacity of fleets of 16 or more robots and saturates a fleet of 8`,
    R`$\lambda=${maxOf(stress.filter((r) => r.layout === 'small' && r.arrivalRate !== null), 'arrivalRate')}$ on \emph{small}`,
    R`\cref{subsec:coupling} $\lambda=${maxOf(byVariant('coupling', 'long-trips/pact'), 'arrivalRate')}$`,
    R`the ${word(leverFamily.length)} lever and planner comparisons of \cref{tab:paired} and the ${word(cascFamily.length)} fallback comparisons`,
    R`family-wise level of 5\%`,
    R`releases all tasks at $t=0$`,
    R`$\delta=${DEFAULT_CONFIG.dwell}$ ticks`,
    R`uniform in $[${f1(DEFAULT_CONFIG.initialSoc[0])},${f1(DEFAULT_CONFIG.initialSoc[1])}]$`,
    R`where it is uniform in $[0.2,0.4]$`,
    R`initial charge in $[0.2,0.4]$ with doubled drain ($\beta_{\mathrm{m}}=${stressBattery.move}$, $\beta_{\mathrm{w}}=${stressBattery.wait}$)`,
    R`where 80\% of pickups are drawn from the 10\% of pickup points`,
    R`drawn only from the 25\% of pickup points`,
    R`Defaults are $w=${DEFAULT_CONFIG.window}$, $h=${DEFAULT_CONFIG.period}$, $K=${DEFAULT_CONFIG.candidateK}$, $\kappa_{\mathrm{d}}=${DEFAULT_CONFIG.dockCapacity}$, $\kappa_{\mathrm{p}}=${DEFAULT_CONFIG.pickupCapacity}$, $w_{\mathrm{b}}=${DEFAULT_CONFIG.wBattery}$`,
    R`delivered tasks per 100 ticks; service`,
    R`for ${DEFAULT_CONFIG.stallLimit} consecutive ticks`,
    R`at ${ic(DEFAULT_CONFIG.maxTicks)} ticks`,
    R`use seeds ${meta.seeds.main[0]}--${meta.seeds.main[1]}, the stress sweep seeds ${meta.seeds.stress[0]}--${meta.seeds.stress[1]} and the other second-round sweeps seeds ${meta.seeds.cascade[0]}--${meta.seeds.cascade[1]}`,
    R`two-sided 95\% Student-$t$ intervals ($n-1$ degrees of freedom`,
    R`Node.js~${String(meta.node).replace(/^v(\d+)\..*$/, '$1')} on an AMD Ryzen~5 5500GT`,
    R`All ${ic(meta.runs)} runs of this paper were produced at one commit of the repository (\texttt{${meta.commit}}), on ${meta.workers} worker processes`,
    R`run in one process ${word(timing.validRepeats.length)} times, a repeat was started only at a one-minute load average of at most ${timing.loadMax}, and`,
    R`the median over the ${word(timing.validRepeats.length)} repeats of the mean over seeds`,
    R`All ${word(timing.validRepeats.length)} repeats were valid, and the largest spread between them is ${Math.ceil(100 * (Math.max(...timing.configs.map((x) => Math.max(...x.perRepeat) / Math.min(...x.perRepeat))) - 1) - 1e-9)}\% of the smallest value`,
    R`the first round (${first.length} runs)`,
    R`\texttt{4a72ff1}`,
    R`(\texttt{dccf403}) by 36 minutes on the same day`,
    R`a gap of 36 minutes`,
  )
  assert(timing.invalidRepeats.length === 0 && timing.attempts === 3 && timing.validRepeats.length === 3 && timing.workers === 1, 'timing: three attempts, three valid repeats, one process')
  assert(timing.load.every((l) => l.before <= timing.loadMax), 'every timing repeat was admitted at or below the load threshold')
  assert(timing.cpu === meta.cpu && timing.node === meta.node, 'timing and results on the same host and Node version')
  assert(meta.runs === SWEEPS.reduce((a, x) => a + R_(x).length, 0) && meta.runs === first.length + secondRuns, 'meta run count equals the records')
  assert(regen.commit === meta.commit && regen.differingFields === 0 && regen.records === meta.runs - tfRuns.length && regen.sweepsWithoutCommittedFile.join() === 'tpfree', 'regeneration: all earlier records identical, tpfree new')
  assert(/node: \[20, 22, 24\]/.test(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')), 'CI matrix: Node 20, 22, 24')
  assert(String(meta.cpu).includes('Ryzen 5 5500GT'), 'CPU model in the meta file')
  assert(B.drainMove === 0.001 && B.drainWait === 0.0002, 'default drain')
  assert(minOf(stress, 'numTasks') === 100 && stress.filter((r) => r.layout !== 'small' && r.arrivalRate !== null).every((r) => r.arrivalRate === 0.15), 'stress sweep: 100 tasks, lambda 0.15 except on small')
  for (const s of ['warehouse', 'console', 'narrow']) assert(mean(R_('main').concat(R_('coupling')).filter((r) => r.layout === s), 'numTasks') === 200, `200 tasks on ${s}`)
  assert(R_('planner').every((r) => r.numTasks === 100 && r.layout === 'small'), '100 tasks on small')

  // Correctness.
  const holdMax = Math.max(...(summary.get('main') as Row[]).map((r) => n(r, 'holdEvents_mean')))
  const holdRow = (summary.get('main') as Row[]).find((r) => n(r, 'holdEvents_mean') === holdMax) as Row
  assert(Number(holdRow.fleetSize) === 32 && holdRow.arrivalRate === 'inf', 'most holds with 32 robots under batch load')
  const sess = ['hungarian', 'hungarian-noBattery', 'pact', 'pact-noBattery'].map((v) => n(batt(v), 'chargeSessions_mean'))
  const soc = ['hungarian', 'hungarian-noBattery', 'pact', 'pact-noBattery'].map((v) => n(batt(v), 'finalMeanSoc_mean'))
  assert(sum(R_('battery'), 'depletionEvents') === 0, 'battery sweep: zero depletions')
  const small4 = stressDrain.filter((r) => r.layout === 'small' && r.fleetSize === 4)
  const narrow8 = stressDrain.filter((r) => r.layout === 'narrow' && r.fleetSize === 8)
  c.push(
    R`Over the ${first.length} first-round runs---${ic(sum(first, 'audit_robotTicks'))} robot-steps, ${ic(sum(first, 'moveActions'))} move actions and ${ic(sum(first, 'tasksCompleted'))} delivered tasks`,
    R`These runs cover ${word(new Set(first.map((r) => r.layout)).size)} layouts`,
    R`fleets of ${minOf(first, 'fleetSize')} to ${maxOf(first, 'fleetSize')} robots, both load`,
    R`(at most ${f1(holdMax)} per run on average in the main sweep, reached with 32 robots`,
    R`forces ${f1(Math.min(...sess))}--${f1(Math.max(...sess))} charging sessions per run for ${batt('pact').fleetSize} robots`,
    R`final mean charge of ${f2(Math.min(...soc))}--${f2(Math.max(...soc))}`,
    R`repeats this check on ${meta.seeds.stress[1]} seeds`,
    R`${ic(stress.length)} runs and ${mil(sum(stress, 'audit_robotTicks'))} million robot-steps`,
    R`With normal batteries (${ic(stressNormal.length)} runs)`,
    R`is ${maxOf(stressNormal, 'audit_maxNoProgress')} ticks and the lowest charge any robot reaches is ${minOf(stressNormal, 'audit_minSoc').toFixed(3)}`,
    R`robots deplete in ${ic(stressDrain.filter((r) => Number(r.depletionEvents) > 0).length)} of ${ic(stressDrain.length)} runs (${ic(sum(stressDrain, 'depletionEvents'))} depletion events), and ${sum(stressDrain, 'deadlocked')} runs stall with ${sum(stressDrain, 'tasksUnfinished')} tasks undelivered`,
    R`up to $Q=${maxOf(stressDrain, 'audit_maxSlotWait')}$ ticks`,
    R`4 robots on \emph{small} and 8 on \emph{narrow}, stay (almost) free of depletions, in ${small4.filter((r) => Number(r.depletionEvents) > 0).length} and ${narrow8.filter((r) => Number(r.depletionEvents) > 0).length} of their ${small4.length} runs`,
    R`a reserve ${f1(Math.min(...reserveFactors.map((x) => x.factor)))} to ${f1(Math.max(...reserveFactors.map((x) => x.factor)))} times the default`,
  )
  assert(sum(stress, 'audit_vertexConflicts') + sum(stress, 'audit_swapConflicts') + sum(stress, 'audit_illegalMoves') === 0, 'stress: no conflict or illegal move')
  assert(stressDrain.filter((r) => Number(r.deadlocked) > 0).every((r) => Number(r.depletionEvents) > 0), 'every stalled stress run had a depletion')
  assert(small4.length === 240 && narrow8.length === 240, '240 doubled-drain runs per fleet')

  // Allocation coupling.
  const [wl, wr, wf] = worstCell
  assert(wl === 'warehouse' && wr === 'inf' && wf === 32, 'largest spread in warehouse/32/batch')
  const t32 = METHODS.map((m) => f1(n(W32(m), 'throughput_mean')))
  assert(t32[1] === t32[2], 'Hungarian and Proxy round to the same throughput')
  const ex = mainExcl[0]
  assert(mainExcl.length === 1 && ex.method === 'pact' && ex.cell.join() === 'console,inf,32' && ex.p.mean < 0, 'the one exclusion is PACT on console/32/batch, below Hungarian')
  const waits32 = w32.map((r) => n(r, 'waitActions_mean'))
  assert(Math.max(...diagCells.map((x) => x.match)) <= 100 / 7, 'the path-aware matching differs in at most one allocation in seven')
  const svcPaired = CELLS.flatMap((c) => ['greedy', 'pact-proxy', 'pact'].map((m) => paired(mainSel(c[0], c[1], c[2], m), mainSel(c[0], c[1], c[2], 'hungarian'), 'meanServiceTime')))
  assert(svcPaired.every((x) => !excludesZero(x)), 'all service-time intervals against Hungarian contain zero')
  // Cells in which the makespan is set by the last arrival: Poisson load, 16 or 32 robots.
  const arrivalBound = CELLS.filter((c) => c[1] !== 'inf' && c[2] >= 16)
  const arrivalGap = Math.max(
    ...['warehouse', 'console'].flatMap((l) =>
      METHODS.flatMap((m) =>
        mainSel(l, '0.15', 16, m).map((a) => {
          const b = mainSel(l, '0.15', 32, m).find((x) => x.seed === a.seed) as Run
          return (100 * Math.abs(Number(a.makespan) - Number(b.makespan))) / Number(b.makespan)
        }),
      ),
    ),
  )
  const range = (rows: Row[], k: string) => Math.max(...rows.map((x) => n(x, `${k}_mean`))) - Math.min(...rows.map((x) => n(x, `${k}_mean`)))
  const cellRows = CELLS.map(([l, r, fl]) => METHODS.map((m) => mainRow(l, r, fl, m)))
  assert(cellRows.every((rows) => range(rows, 'throughput') < Math.min(...rows.map((x) => n(x, 'throughput_std')))), 'throughput means differ by less than the smallest standard deviation in every cell')
  assert(cellRows.every((rows) => range(rows, 'meanServiceTime') < Math.max(...rows.map((x) => n(x, 'meanServiceTime_std')))), 'service-time means differ by less than the largest standard deviation in every cell')
  c.push(
    R`more than ${f1(maxSpread)}\% (warehouse, 32 robots, batch: ${t32[0]} greedy vs.\ ${t32[1]} Hungarian and Proxy vs.\ ${t32[3]} \sname)`,
    R`${mainPaired.length - mainExcl.length} of the ${mainPaired.length} throughput intervals`,
    R`with 32 robots under batch load, $${f1(Math.abs(ex.p.mean))}\pm${f1(ex.p.half)}\%$ \emph{below} Hungarian`,
    R`${mainPaired.length} independent 95\% intervals of true-zero effects would give ${f1(0.05 * mainPaired.length)} on average`,
    R`within $\pm${f1(worstPoisson)}\%$ under the Poisson load and within $\pm${f1(worstBatch)}\%$ under batch load`,
    R`with 32 robots, where ${f0(Math.min(...waits32))}--${f0(Math.max(...waits32))} wait actions per run`,
    R`${Word(arrivalBound.length)} of the ${word(CELLS.length)} cells cannot show`,
    R`a fleet of 16 or 32 robots keeps up`,
    R`at most ${up1(arrivalGap)}\% between 16 and 32 robots`,
    R`The ${word(3 * arrivalBound.length)} throughput intervals of those cells`,
    R`all ${svcPaired.length} service-time intervals against Hungarian contain zero (smallest $p=${Math.min(...svcPaired.map((x) => x.p)).toFixed(2)}$); their bounds reach $${up1(Math.max(...svcPaired.map(bound)))}\%$ (half-widths up to $\pm${f1(Math.max(...svcPaired.map((x) => x.half)))}\%$)`,
    R`In none of the ${word(CELLS.length)} layout/fleet/load cells`,
    R`For ${cellBeyond}\% of the priced pairs the pickup lies`,
    R`for ${cellDiffer}\% of the pairs, by ${cellGap} ticks on average against a mean distance of ${rng0(diagCells.map((x) => x.dbar))}, and it changes the matching in ${cellMatch}\% of the allocations`,
    R`differs for ${rng0(diagCellsProxy.map((x) => x.differ))}\% of the pairs and changes the matching in ${rng0(diagCellsProxy.map((x) => x.match))}\% of the allocations`,
    R`at most one allocation in seven`,
    R`only the $K=${DEFAULT_CONFIG.candidateK}$ tasks nearest`,
  )

  // Planner backend.
  const cbsMs = [4, 6, 8].map((fl) => pms(plan(fl, 'cbs')))
  const fb = [4, 6, 8].map((fl) => n(plan(fl, 'cbs'), 'cbsFallbacks_mean'))
  assert(fb[0] === 0 && fb[2] === 0 && fb[1] > 0, 'CBS fallbacks only at 6 robots in the planner sweep')
  const w32c = cbsAt('warehouse', 32)
  const w32s = splitBig.find((x) => x.layout === 'warehouse' && x.fleet === 32) as (typeof splitBig)[number]
  assert(splitBig.every((x) => excludesZero(x.batch) && x.batch.mean < 0), 'CBS gain under batch load resolved on every larger layout')
  assert(cbsPaired.map(excludesZero).join() === 'true,true,true' && leverSurvivors.includes('cbs6') && !leverSurvivors.includes('cbs4') && !leverSurvivors.includes('cbs8'), 'planner sweep: nominal at 4, 6, 8; Holm keeps 6')
  const n16c = cbsAt('narrow', 16)
  c.push(
    R`by ${f1(-cbsMakespan[0])}\%, ${f1(-cbsMakespan[1])}\% and ${f1(-cbsMakespan[2])}\% for 4, 6 and 8 robots (seed-paired: $${ci(cbsPaired[0])}$, $${ci(cbsPaired[1])}$ and $${ci(cbsPaired[2])}\%$)`,
    R`cuts wait actions by ${f0(Math.min(...cbsWaits.map(Math.abs)))}--${f0(Math.max(...cbsWaits.map(Math.abs)))}\% and service time by ${f0(Math.min(...cbsService.map(Math.abs)))}--${f0(Math.max(...cbsService.map(Math.abs)))}\%, while expanding ${[4, 6, 8].map((fl) => f2(eptOf(plan(fl, 'cbs')) / eptOf(plan(fl, 'pp')))).join(', ').replace(/, ([^,]*)$/, ' and $1')} times as many A* nodes per tick as PP (${f2(Math.min(...cbsMs))}--${f2(Math.max(...cbsMs))} planner ms per tick)`,
    R`only the one at 6 robots survives the Holm correction; the stress sweep below repeats the comparison on ${cbsSmall[0].pairs} seed pairs per fleet size`,
    R`in ${f1(fb[1])} epochs per run, only at 6 robots`,
    R`falls back to PP in ${f1(Math.min(...cbsBig.map((x) => x.fallbacks)))} to ${f0(Math.max(...cbsBig.map((x) => x.fallbacks)))} epochs per run (${f1(w32c.fallbacks)} of about ${f0(w32c.epochs)} on the warehouse with 32 robots, ${f0(n16c.fallbacks)} of about ${f0(n16c.epochs)} on \emph{narrow} with 16; over the whole sweep ${ic(sum(stressCbs, 'cbsBudgetExceeded'))} of its ${ic(sum(stressCbs, 'cbsFallbacks'))} fallbacks`,
    R`it shortens the makespan by ${f0(Math.min(...cbsSmall.map((x) => Math.abs(x.mean))))}--${f0(Math.max(...cbsSmall.map((x) => Math.abs(x.mean))))}\% (seed-paired over ${w32c.pairs} pairs: ${cbsSmall.map((x, i) => R`$-${f1(Math.abs(x.mean))}\pm${f1(x.half)}${i === 2 ? R`\%` : ''}$`).join(', ').replace(/, ([^,]*)$/, ' and $1')} for 4, 6 and 8 robots)`,
    R`under batch load is ${f1(Math.min(...splitBig.map((x) => Math.abs(x.batch.mean))))}--${f1(Math.max(...splitBig.map((x) => Math.abs(x.batch.mean))))}\% (${w32s.batch.n} pairs, e.g.\ $-${f1(Math.abs(w32s.batch.mean))}\pm${f1(w32s.batch.half)}\%$ on the warehouse with 32 robots)`,
    R`the difference is at most ${up1(Math.max(...splitBig.map((x) => Math.abs(x.poisson.mean))))}\%`,
    R`CBS expands ${f1(Math.min(...splitBig.map((x) => x.expBatch)))} to ${f1(Math.max(...splitBig.map((x) => x.expBatch)))} times as many A* nodes per tick as PP on the larger layouts under batch load`,
  )
  assert(sum(stressCbs, 'cbsFallbacks') - sum(stressCbs, 'cbsBudgetExceeded') === 2, 'two CBS fallbacks are failed searches')

  // Scaling.
  const s4 = scal(4, 'hungarian')
  const s48h = scal(48, 'hungarian')
  const s48p = scal(48, 'pact')
  assert(n(scal(48, 'hungarian'), 'throughput_mean') - n(scal(40, 'hungarian'), 'throughput_mean') < 1, 'throughput flattens beyond 40 robots')
  assert(eptOf(scal(32, 'hungarian')) / eptOf(s4) > 32 / 4 && eptOf(s48h) / eptOf(scal(32, 'hungarian')) < 48 / 32, 'expansions per tick grow faster than the fleet up to 32 robots and slower after')
  c.push(
    R`from 4 to 48 robots under batch load`,
    R`rises from ${f1(n(s4, 'throughput_mean'))} to ${f1(n(s48p, 'throughput_mean'))} tasks per 100 ticks and flattens beyond 40 robots, where utilisation has fallen to ${f2(n(s48h, 'utilization_mean'))} because $${LW.docks}$ docks $\times\,\kappa_{\mathrm{d}}=${DEFAULT_CONFIG.dockCapacity}$`,
    R`falls from ${f0(n(s4, 'meanServiceTime_mean'))} to ${f0(n(s48h, 'meanServiceTime_mean'))} ticks`,
    R`grow ${f0(eptOf(s48h) / eptOf(s4))}-fold for ${f0(48 / 4)} times as many robots, from ${f0(eptOf(s4))} at 4 robots to ${f0(eptOf(scal(32, 'hungarian')))} at 32 and ${ic(eptOf(s48h))} at 48 (planner time from ${f2(pms(s4))} to ${f2(pms(s48h))} ms per simulated tick, and to ${f2(pms(s48p))} for \sname)`,
    R`costs ${f0(100 * (n(s48p, 'astarCalls_mean') / n(s48h, 'astarCalls_mean') - 1))}\% more A* calls at 48 robots (${ic(n(s48p, 'astarCalls_mean'))} vs.\ ${ic(n(s48h, 'astarCalls_mean'))} per run) and ${f0(100 * (eptOf(s48p) / eptOf(s48h) - 1))}\% more expansions per tick`,
  )

  // Ablations.
  const d4 = casc('warehouse-32-dock4', 'cascade')
  const d3 = casc('warehouse-32', 'cascade')
  const noEv = [100 * (n(abl('pact-noEvent'), 'throughput_mean') / n(pactDefault, 'throughput_mean') - 1), 100 * (n(abl('hungarian-noEvent'), 'throughput_mean') / n(W32('hungarian'), 'throughput_mean') - 1)]
  const noEvWaits = [n(abl('pact-noEvent'), 'waitActions_mean') - n(pactDefault, 'waitActions_mean'), n(abl('hungarian-noEvent'), 'waitActions_mean') - n(W32('hungarian'), 'waitActions_mean')]
  const noBat = [n(abl('pact-noBattery'), 'throughput_mean') - n(pactDefault, 'throughput_mean'), n(abl('hungarian-noBattery'), 'throughput_mean') - n(W32('hungarian'), 'throughput_mean')]
  const kDiff = Math.max(...['pact-K3', 'pact-K12'].map((v) => Math.abs(n(abl(v), 'throughput_mean') - n(pactDefault, 'throughput_mean'))))
  const battDiff = Math.max(Math.abs(n(batt('pact-noBattery'), 'throughput_mean') - n(batt('pact'), 'throughput_mean')), Math.abs(n(batt('hungarian-noBattery'), 'throughput_mean') - n(batt('hungarian'), 'throughput_mean')))
  assert(battDiff < 0.5 && Math.max(...noBat.map(Math.abs)) < 0.5, 'battery term changes throughput by less than 0.5')
  assert(excludesZero(pNoEvH) && !excludesZero(pNoEvP) && !leverSurvivors.includes('noEvH'), 'only the Hungarian no-event loss is resolved, at the nominal level')
  assert(excludesZero(pW30) && !leverSurvivors.includes('w30'), 'window 30: nominal only')
  assert(![pH1, pNoBatP, pNoBatH, pK3, pK12].some(excludesZero), 'h=1, battery term and K: intervals contain zero')
  assert(sum(d4, 'deadlocked') === 0 && sum(d4, 'tasksUnfinished') === 0 && d4.length === 30, 'capacity 4 completes all 30 runs')
  assert(sum(casc('warehouse-32-dock4', 'static'), 'deadlocked') === 30, 'capacity 4 with static priorities stalls in every run')
  c.push(
    R`on the warehouse with 32 robots under batch load.`,
    R`from ${DEFAULT_CONFIG.dockCapacity} to 2 drops throughput from ${f1(n(W32('pact'), 'throughput_mean'))} to ${f1(n(abl('pact-dock2'), 'throughput_mean'))} (\sname) and from ${f1(n(W32('hungarian'), 'throughput_mean'))} to ${f1(n(abl('hungarian-dock2'), 'throughput_mean'))} (Hungarian`,
    R`capacity ${DEFAULT_CONFIG.dockCapacity} is worth $+${f0(Math.min(dockGainPact, dockGainHung))}$--$${f0(Math.max(dockGainPact, dockGainHung))}\%$ (seed-paired, capacity 2 costs $${f1(Math.abs(pDock2P.mean))}\pm${f1(pDock2P.half)}\%$ and $${f1(Math.abs(pDock2H.mean))}\pm${f1(pDock2H.half)}\%$), and utilisation falls from ${f2(n(pactDefault, 'utilization_mean'))} to ${f2(n(abl('pact-dock2'), 'utilization_mean'))}`,
    R`capacity 4 produced dock-front gridlocks`,
    R`capacity 4 completes all ${d4.length} runs of`,
    R`(throughput ${f1(mean(d4, 'throughput'))}, seed-paired $${ci(pDock4)}\%$ over capacity ${DEFAULT_CONFIG.dockCapacity}) but needs more than twice the holds (${f1(mean(d4, 'holdEvents'))} per run against ${f1(mean(d3, 'holdEvents'))})`,
    R`We keep capacity ${DEFAULT_CONFIG.dockCapacity} as the default`,
    R`A window of 10 ticks raises throughput to ${f1(n(abl('pact-w10'), 'throughput_mean'))} ($+${f0(w10Gain)}\%$, seed-paired $${ci(pW10)}\%$) and halves wait actions (${f0(n(abl('pact-w10'), 'waitActions_mean'))} vs.\ ${f0(n(pactDefault, 'waitActions_mean'))}) while cutting the A* expansions per tick to ${f2(eptOf(abl('pact-w10')) / eptOf(pactDefault))} of the default (planner time from ${f2(pms(pactDefault))} to ${f2(pms(abl('pact-w10')))} ms/tick); a window of 30 lowers throughput to ${f1(n(abl('pact-w30'), 'throughput_mean'))} ($${ci(pW30)}\%$, nominal) at ${f1(eptOf(abl('pact-w30')) / eptOf(pactDefault))} times the expansions per tick (${f2(pms(abl('pact-w30')))} ms/tick)`,
    R`($h=1$) shows no throughput change (${f1(n(abl('pact-h1'), 'throughput_mean'))}; seed-paired $${ci(pH1)}\%$, an interval too wide to call it none) at $${f1(eptOf(abl('pact-h1')) / eptOf(pactDefault))}\times$ the A* expansions per tick`,
    R`the window of 10 and CBS at 6 robots`,
    R`Of the ${word(leverFamily.length)} lever and planner intervals of \cref{tab:paired}, ${word(leverSurvivors.length)} survive`,
    R`With ${word(meta.seeds.ablation[1])} seeds these ${word(4)} comparisons have seed-paired intervals of $\pm${f1(Math.min(...[pNoBatP, pNoBatH, pK3, pK12].map((x) => x.half)))}$ to $\pm${f1(Math.max(...[pNoBatP, pNoBatH, pK3, pK12].map((x) => x.half)))}\%$`,
    R`costs ${f0(Math.min(...noEv.map(Math.abs)))}--${f0(Math.max(...noEv.map(Math.abs)))}\% throughput and adds ${f0(Math.min(...noEvWaits))}--${f0(Math.max(...noEvWaits))} wait actions`,
    R`($${ci(pNoEvH)}\%$, against $${ci(pNoEvP)}\%$ for \sname)`,
    R`($w_{\mathrm{b}}=0$) changes throughput by less than 0.5 for both cost models ($${s2(noBat[0])}$ for \sname, $${s2(noBat[1])}$ for Hungarian)`,
    R`with $\theta_{\mathrm{lo}}=${B.socLow}$ and`,
    R`Pricing 3 or 12 candidates instead of ${DEFAULT_CONFIG.candidateK} changes throughput by at most ${up2(kDiff)}`,
  )
  assert(n(abl('pact-w10'), 'waitActions_mean') < 0.6 * n(pactDefault, 'waitActions_mean'), 'w=10 roughly halves wait actions')

  // Cascade.
  const none = cascConflictRuns('none')
  const restart = cascConflictRuns('restart')
  assert(CASC.every((s) => withConflict(casc(s, 'cascade')) === 0 && sum(casc(s, 'cascade'), 'deadlocked') === 0), 'with the cascade no conflict and no stall')
  assert(CASC.every((s) => withConflict(casc(s, 'static')) === 0), 'static priorities stay conflict-free')
  assert(restart[2] === 0, 'restarts avoid conflicts on small')
  assert(cascFamily.filter((_, i) => cascHolm[i]).map(([k]) => k).join() === 'warehouse-32-dock4/none', 'Holm over the eight fallback comparisons keeps no-repair at capacity 4 only')
  assert(cascFamily.filter(([, x]) => excludesZero(x)).map(([k]) => k).join() === 'warehouse-32-dock4/none,warehouse-32-dock4/restart,narrow-16/restart', 'nominal exclusions among the fallback comparisons')
  assert(staticStalled[0] === 30 && staticStalled[1] === 30 && staticStalled[3] === 30, 'static priorities: 30 of 30 on warehouse (both capacities) and narrow')
  assert(CASC.every((s) => mean(casc(s, 'static'), 'holdEvents') > 300), 'hundreds to thousands of holds per run with static priorities')
  c.push(
    R`measures both on 30 seeds in four settings, including the capacity-4 docks`,
    R`conflicts are executed in ${none[0]}, ${none[1]}, ${none[2]} and ${none[3]} of the 30 runs per setting`,
    R`(${restart[0]}, ${restart[1]} and ${restart[3]} of 30 runs)`,
    R`within ${up2(cascSpread)} tasks per 100 ticks of each other`,
    R`dropping the repair gains $${ci(cascPair('warehouse-32-dock4', 'none'))}\%$ with capacity-4 docks, the one difference among the ${word(cascFamily.length)} that survives`,
    R`gain $${ci(cascPair('warehouse-32-dock4', 'restart'))}\%$ there and $${ci(cascPair('narrow-16', 'restart'))}\%$ on \emph{narrow} at the nominal level, and the other ${word(cascFamily.filter(([, x]) => !excludesZero(x)).length)} intervals contain zero`,
    R`up to about ${f0(cascPair('warehouse-32-dock4', 'none').mean)}\% of throughput`,
    R`conflicts on \emph{small} but not on the larger layouts`,
    R`30 of 30 runs stall on the warehouse, with and without capacity-4 docks, and on \emph{narrow}, and ${staticStalled[2]} of 30 on \emph{small}`,
  )

  // Baselines.
  assert(tpRuns.length === 300 && tpRuns.every((r) => violations(r) === 0 && Number(r.deadlocked) === 0 && Number(r.depletionEvents) === 0), '300 TP/TPTS runs without conflict, stall or depletion')
  assert(sum(tpRuns, 'tpSearchLimitHits') === 0 && sum(tpRuns, 'tpSwapVetoes') === 0, 'TP additions inactive')
  assert(tfRuns.length === 600 && tfRuns.every((r) => violations(r) === 0 && Number(r.conflicts) === 0 && Number(r.deadlocked) === 0 && Number(r.depletionEvents) === 0 && Number(r.tasksUnfinished) === 0), 'token-passing variants: no conflict, stall, depletion or unfinished task')
  // The adapted published rule (section 4.3, Table 8, appendix A): read off the simulator source.
  const simSrc = readFileSync(join(ROOT, 'src/fms/sim/simulator.ts'), 'utf8').replace(/\s+/g, ' ')
  assert(
    simSrc.includes('const mustMove = this.pending.some((t) => t.delivery === r.cell || t.pickup === r.cell) || chargerSlots(this.map).includes(r.cell)'),
    "'faithful' moves off a delivery cell (Ma et al.) and, as the two added triggers, off a pickup cell and a charger slot",
  )
  assert(simSrc.includes('const cands = [...this.map.homes, ...this.map.deliveries] .filter((c) => c !== r.cell && !ends.has(c) && !wanted.has(c))'), "Path2 targets: home bays and docks, no other path's end, no pending delivery; pickups are not endpoints")
  assert(simSrc.includes("const escape = this.cfg.tpFree === 'faithful' ? this.tpPath2(owner) : this.tpPlanTo(owner, owner.home)"), "task swap under 'faithful': the displaced robot escapes to a Path2 endpoint, otherwise to its home bay")
  assert(BASE[1] === 'warehouse-32-batch' && BASE[4] === 'narrow-16-batch', 'the two settings named in the Holm sentence')
  assert(tptsFamily.length === 10 && tptsHolm.slice(5).join() === 'true,false,true,true,false' && tptsHolm15.slice(5, 10).join() === tptsHolm.slice(5).join(), 'Holm over the ten (and the fifteen) TPTS-versus-loop intervals keeps interruptible TPTS in three settings and drops the two with p of 0.033 and 0.032')
  assert(intRh.every((x) => x.mean > 0) && Math.max(...intRh.map((x) => x.mean)) === Math.max(...tptsAllRh), 'interruptible TPTS is ahead of the loop in every setting and is the best variant')
  assert(regMatch.filter((_, i) => REGIMES[i] !== 'hotspot').every((m) => m < diagReg('hotspot').match), 'hotspot has the highest matching-change share of the four regimes')
  assert(intHome.every((x) => x.mean - x.half > 0) && intRh.every((x) => x.mean - x.half > 0), 'interruptible TPTS: resolved gain over home and over the loop at capacity 1 in every setting')
  assert(diagReg('hotspot').match >= 1.8 * Math.max(...diagCells.map((x) => x.match)), 'hotspot changes the matching about twice as often as any main cell')
  assert(pactSafe.filter((x) => x.reg === 'hotspot').every((x) => !excludesZero(x.p)), 'hotspot: every interval of the path-aware cost contains zero')
  assert(pactVsH.every((p) => !excludesZero(p)) && pactVs1.filter(excludesZero).length === 1, 'PACT vs Hungarian: no exclusion at the default capacity, one at capacity 1')
  const hair = pactVs1.find(excludesZero) as Paired
  assert(BASE[pactVs1.indexOf(hair)] === 'warehouse-16-poisson', 'the one exclusion is under Poisson load')
  const tptsA = astar('tpts')
  const rnd = (x: number, to: number) => ic(Math.round(x / to) * to)
  c.push(
    R`in the ${tpRuns.length} TP and TPTS runs`,
    R`the ${ic(DEFAULT_CONFIG.tpMaxExpansions)}-expansion bound`,
    R`TP delivers ${f0(Math.min(...tpVsH.map(Math.abs)))}--${f0(Math.max(...tpVsH.map(Math.abs)))}\% less throughput`,
    R`and TPTS ${f0(Math.min(...tptsVsH.map(Math.abs)))}--${f0(Math.max(...tptsVsH.map(Math.abs)))}\% less, in every setting`,
    R`($\kappa_{\mathrm{d}}=1$), the rolling-horizon`,
    R`differ by $${sgn(Math.min(...tptsVs1))}$ to $${sgn(Math.max(...tptsVs1))}\%$ (TPTS relative`,
    R`TP stays ${f0(Math.min(...tpVs1.map(Math.abs)))}--${f0(Math.max(...tpVs1.map(Math.abs)))}\% behind it`,
    R`with ${rnd(Math.min(...tptsA), 1000)}--${rnd(Math.max(...tptsA), 1000)} A* calls per run, against ${rnd(Math.min(...rhAstar), 100)}--${rnd(Math.max(...rhAstar), 100)} for the rolling-horizon loop`,
    R`in ${f0(diagReg('hotspot').match)}\% of the allocations, about twice the share of any cell`,
    R`${f0(diagReg('narrow-aisles').match)}\% in the one-lane aisles, ${f0(diagReg('long-trips').match)}\% under long empty trips, where ${f0(diagReg('long-trips').beyond)}\% of the priced pickups lie beyond the window, and ${f0(diagReg('saturated-chargers').match)}\% with saturated chargers`,
    R`TP changes by at most ${up1(tpMove)}\% under either variant`,
    R`TPTS gains ${rng1(intHome.map((x) => x.mean))}\% in every setting (all ${word(intHome.length)} intervals exclude zero) and then delivers ${rng1(intRh.map((x) => x.mean))}\% more`,
    R`again with all ${word(intRh.length)} intervals above zero`,
    R`between ${f1(Math.abs(Math.min(...faiHome.map((x) => x.mean))))}\% below and ${f1(Math.max(...faiHome.map((x) => x.mean)))}\% above our home variant and between ${f1(Math.abs(Math.min(...faiRh.map((x) => x.mean))))}\% below and ${f1(Math.max(...faiRh.map((x) => x.mean)))}\% above`,
    R`ahead of our loop in every setting, so at equal
capacity our loop is slightly behind the best token-passing variant`,
    R`Two of
the five intervals (warehouse with 32 robots, $p=${f3(intRh[1].p)}$, and narrow, $p=${f3(intRh[4].p)}$)
do not survive a Holm correction over the ${word(tptsFamily.length)} intervals of the home and
interruptible variants against the loop`,
    R`TPTS lies, across the ${word(faiRh.length)} settings, between`,
    R`Under every idle rule the gap at the default
capacity remains (TPTS at least ${Math.floor(tptsBehind3)}\% behind)`,
    R`at the default capacity all ${word(pactVsH.length)} intervals contain zero`,
    R`with triple drain every method strands robots`,
    R`none of \sname's ${word(pactSafe.length)} intervals excludes zero`,
    R`at $\kappa_{\mathrm{d}}=1$ one of five excludes it by a hair ($${ci(hair)}\%$ under Poisson load)`,
  )

  // Coupling regimes.
  assert(pactSafe.length === 12 && pactSafe.every((x) => !excludesZero(x.p)), "none of PACT's twelve intervals excludes zero")
  const pactThr = pactSafe.filter((x) => x.k === 'throughput').map((x) => Math.abs(x.p.mean))
  const pactSvc = pactSafe.filter((x) => x.k !== 'throughput').map((x) => Math.abs(x.p.mean))
  const longBound = Math.max(...pactSafe.filter((x) => x.reg === 'long-trips').map((x) => bound(x.p)))
  const px = (reg: string, b: string, k: string) => (proxyExcl.find((x) => x.reg === reg && x.b === b && x.k === k) as (typeof proxyExcl)[number]).p
  assert(proxyExcl.length === 5, 'five proxy intervals exclude zero in the safe regimes')
  const allSafeExcl = SAFE.flatMap((reg) => [cp(reg, 'greedy', 'hungarian', 'throughput'), cp(reg, 'greedy', 'hungarian', 'meanServiceTime')]).filter(excludesZero).length
  assert(allSafeExcl === 0, 'greedy vs Hungarian: no exclusion in the safe regimes')
  c.push(
    R`compete for ${LW.slots} slots`,
    R`on 30 paired seeds`,
    R`at most ${f1(Math.max(...pactThr))}\% in throughput and ${f1(Math.max(...pactSvc))}\% in service time`,
    R`exclude effects above ${f1(longBound)}\%`,
    R`($${ci(px('narrow-aisles', 'hungarian', 'throughput'))}\%$ throughput on one-lane aisles, $${ci(px('hotspot', 'hungarian', 'throughput'))}\%$ throughput and $${ci(px('hotspot', 'hungarian', 'meanServiceTime'))}\%$ service time under hotspot demand, $${ci(px('long-trips', 'hungarian', 'meanServiceTime'))}\%$ service time on long trips, and $${ci(px('long-trips', 'greedy', 'meanServiceTime'))}\%$ against greedy there)`,
    R`(${Math.min(...satDepl)}--${Math.max(...satDepl)} depletion events over 30 runs) and ${Math.min(...satStall)}--${Math.max(...satStall)} of its 30 runs stall`,
    R`show $${sgn(cp(SAT, 'pact', 'hungarian', 'throughput').mean, f0)}\pm${f0(cp(SAT, 'pact', 'hungarian', 'throughput').half)}\%$ and $${sgn(cp(SAT, 'pact-proxy', 'hungarian', 'throughput').mean, f0)}\pm${f0(cp(SAT, 'pact-proxy', 'hungarian', 'throughput').half)}\%$ throughput against Hungarian`,
    R`($${ci(cp(SAT, 'pact', 'hungarian', 'meanServiceTime'))}\%$)`,
    R`(${satStall[3]} for \sname, ${satStall[1]} for Hungarian)`,
    R`unresolved $${ci(cp(SAT, 'greedy', 'hungarian', 'throughput'))}\%$ against Hungarian (${satStall[0]} stalled runs)`,
    R`($${ci(cp(SAT, 'pact', 'greedy', 'throughput'))}\%$ for \sname, $${ci(cp(SAT, 'pact-proxy', 'greedy', 'throughput'))}\%$ for the proxy)`,
  )
  assert(Math.max(...satStall) === satStall[1] && Math.min(...satStall) === satStall[3], 'stalled runs: fewest for PACT, most for Hungarian')
  return {
    file: 'sections/4_experiments.tex',
    mode: 'all',
    claims: c,
    structural: [R`rolling-horizon loop at $\kappa_{\mathrm{d}}=1$, again`, R`above the loop at $\kappa_{\mathrm{d}}=1$:`, '(Q1)', '(Q2)', '(Q3)', '(Q3, part 1)', '(Q3, part 2)', 'for Q1,', 'for Q2', R`finite window changes throughput by less than 1\%`],
  }
}


function appendix(): FileSpec {
  const C = DEFAULT_CONFIG
  const B = DEFAULT_BATTERY
  const lay = (name: string, L: ReturnType<typeof layoutRow>, aisle: string) => R`${name} & ${L.size} & ${L.free} & ${L.pickups} & ${L.docks} & ${L.slots} (${L.stations}) & ${L.homes} & ${aisle}\\`
  assert(siteDocks === 2 && LC.docks === 3 * siteDocks, 'console: two named docks, three delivery cells each')
  assert(metricKeys.length - CONFIG_KEYS.length === 36 && CONFIG_KEYS.every((k) => metricKeys.includes(k)) && SWEEPS.every((x) => Object.keys(R_(x)[0]).length === recordKeys.length), 'SimMetrics: 10 configuration fields and 36 measured ones, the same schema in every sweep')
  return {
    file: 'sections/appendix.tex',
    mode: 'all',
    claims: [
      R`bash scripts/regenerate.sh ${meta.workers}    # all ${word(SWEEPS.length)} sweeps, ${meta.runs.toLocaleString('en-US')} runs`,
      R`planner times: ${word(timing.validRepeats.length)} repeats on an idle host`,
      R`at commit \texttt{${meta.commit}} of the repository, on ${meta.workers} worker processes`,
      R`For the ${ic(regen.records)} runs that existed before, which had been written at earlier commits on 1 and 10 worker processes, no field differed`,
      R`the ${tfRuns.length} runs of \cref{tab:tpfree} are new`,
      R`for the ${first.length} first-round runs on other hardware under Node.js 20, 22 and 24`,
      R`${word(timing.validRepeats.length)} single-process repeats of the planner, scaling and ablation sweeps, each started only at a one-minute load average of at most ${timing.loadMax}`,
      R`were written under ${meta.workers} workers and are not used`,
      R`leaving out the ${word(4)} wall-clock fields`,
      R`bounded by ${ic(C.tpMaxExpansions)} expansions`,
      R`window $w$ / period $h$ & ${C.window} / ${C.period} ticks`,
      R`candidates $K$ & ${C.candidateK} &`,
      R`$\kappa_{\mathrm{d}}$ / $\kappa_{\mathrm{p}}$ & ${C.dockCapacity} / ${C.pickupCapacity} &`,
      R`$w_{\mathrm{b}}$ / $w_{\mathrm{c}}$ / $w_{\mathrm{h}}$ & ${C.wBattery} / ${C.congestionWeight} / ${C.holdPenalty} &`,
      R`$\beta_{\mathrm{m}}$ / $\beta_{\mathrm{w}}$ / $\gamma$ & ${B.drainMove} / ${B.drainWait} / ${B.chargeRate} &`,
      R`$\theta_{\mathrm{lo}}$ / $\theta_{\mathrm{hi}}$ / $\rho$ & ${B.socLow} / ${B.socHigh} / ${B.reserve} &`,
      R`initial charge & $\mathcal{U}[${f1(C.initialSoc[0])},${f1(C.initialSoc[1])}]$ & $\mathcal{U}[0.2,0.4]$ in the battery stress`,
      R`dwell $\delta$ & ${C.dwell} ticks`,
      R`CBS node budget & ${C.cbsMaxNodes} &`,
      R`stall limit & ${C.stallLimit} ticks`,
      R`run limit & ${ic(C.maxTicks)} ticks`,
      R`tasks per run & ${C.numTasks} (100 on \emph{small}; stress: ${maxOf(stress, 'numTasks')})`,
      R`seeds & ${meta.seeds.main[0]}--${meta.seeds.main[1]} & ${meta.seeds.stress[0]}--${meta.seeds.stress[1]} stress; ${meta.seeds.cascade[0]}--${meta.seeds.cascade[1]} other second-round sweeps`,
      R`(zones A--D with ${zoneLines.join(', ')} shelf lines;`,
      lay('small', LS, 'open'),
      lay('warehouse', LW, '2'),
      lay('console', LC, '2'),
      lay('narrow', LN, '1'),
      R`the ${metricKeys.length} fields of \texttt{SimMetrics} (${CONFIG_KEYS.length} that identify the configuration and ${metricKeys.length - CONFIG_KEYS.length} measured quantities) and ${auditKeys.length} auditor fields`,
    ],
    structural: ['4-connected grid graph', R`A^{\mathcal{B}}(p,g,t_0)`, 'Path2 endpoint'],
    always: [R`pool size & $\max(${POOL_FACTOR}m,${POOL_MIN})$ &`],
  }
}

// ---------------------------------------------------------------- 4. coverage

const norm = (s: string) => s.replace(/(^|[^\\])%.*$/gm, '$1').replace(/\s+/g, ' ')

function maskAll(text: string, mask: Uint8Array, needle: string): number {
  let count = 0
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    mask.fill(1, i, i + needle.length)
    count += 1
  }
  return count
}

function maskRegex(text: string, mask: Uint8Array, re: RegExp): void {
  for (const m of text.matchAll(re)) mask.fill(1, m.index, m.index + m[0].length)
}

function checkProse(spec: FileSpec): void {
  const text = norm(readFileSync(join(PAPER, spec.file), 'utf8'))
  const mask = new Uint8Array(text.length)
  for (const claim of spec.claims) {
    if (maskAll(text, mask, norm(claim)) === 0) fail(`${spec.file}: expected text not found: ${claim}`)
  }
  for (const s of spec.structural) {
    if (maskAll(text, mask, s) === 0) fail(`${spec.file}: structural numeral no longer in the text (remove it from the guard): ${s}`)
  }
  for (const a of spec.always ?? []) {
    if (maskAll(text, mask, norm(a)) === 0) fail(`${spec.file}: expected formula not found: ${a}`)
  }
  // Number words: recomputed when a claim covers them, pinned to the snapshot otherwise.
  const words: string[] = []
  for (const m of text.matchAll(NUMBER_WORD)) {
    if (spec.mode === 'caption') continue
    let covered = true
    for (let i = m.index; i < m.index + m[0].length; i += 1) if (!mask[i]) covered = false
    if (!covered) words.push(text.slice(Math.max(0, m.index - 30), Math.min(text.length, m.index + m[0].length + 30)))
  }
  pinsNow[`${spec.file}#words`] = words
  if (spec.pinMath) {
    const frags: string[] = []
    for (const m of text.matchAll(/\\begin\{(equation|algorithm)\}.*?\\end\{\1\}|\$[^$]*\$/g)) if (/[0-9]/.test(m[0])) frags.push(m[0])
    pinsNow[`${spec.file}#math`] = frags
  }
  // References, citation keys and file names are not numbers of the paper.
  maskRegex(text, mask, /\\(label|cref|Cref|ref|citep|citet|citealp|input|url|includegraphics)\{[^}]*\}/g)
  if (spec.mode === 'nomath') {
    maskRegex(text, mask, /\\begin\{(equation|algorithm)\}.*?\\end\{\1\}/g)
    maskRegex(text, mask, /\$[^$]*\$/g)
  }
  let lo = 0
  let hi = text.length
  if (spec.mode === 'caption') {
    lo = text.indexOf(R`\caption{`)
    let depth = 0
    hi = lo
    for (let i = lo + 8; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      if (text[i] === '}') {
        depth -= 1
        if (depth === 0) {
          hi = i
          break
        }
      }
    }
  }
  const seen = new Set<number>()
  for (let i = lo; i < hi; i += 1) {
    if (mask[i] || text[i] < '0' || text[i] > '9') continue
    let a = i
    while (a > 0 && text[a - 1] !== ' ') a -= 1
    if (seen.has(a)) continue
    seen.add(a)
    fail(`${spec.file}: number not covered by any claim: "...${text.slice(Math.max(0, a - 40), Math.min(text.length, i + 30))}..."`)
  }
}

/** Words that state a number or a ratio. */
const NUMBER_WORD = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|sixty|hundred|hundreds|thousand|thousands|twice|thrice|double|doubled|doubles|triple|tripled|half|halves|third|thirds|quarter|fifth)\b/gi
const PINS = join(ROOT, 'paper/experiments/guard/pins.json')
const pinsNow: Record<string, string[]> = {}

function checkPins(): void {
  if (process.argv.includes('--update-pins')) {
    mkdirSync(join(ROOT, 'paper/experiments/guard'), { recursive: true })
    writeFileSync(PINS, `${JSON.stringify(pinsNow, null, 1)}\n`)
    console.log(`pins written to ${PINS}`)
    return
  }
  if (!existsSync(PINS)) {
    fail('no pin snapshot (run: npm run check:paper -- --update-pins)')
    return
  }
  const old = JSON.parse(readFileSync(PINS, 'utf8')) as Record<string, string[]>
  for (const key of new Set([...Object.keys(old), ...Object.keys(pinsNow)])) {
    const a = old[key] ?? []
    const b = pinsNow[key] ?? []
    const gone = a.filter((x) => !b.includes(x))
    const added = b.filter((x) => !a.includes(x))
    for (const x of added.slice(0, 3)) fail(`${key}: pinned text changed or is new (review it, then: npm run check:paper -- --update-pins): "${x}"`)
    if (added.length === 0 && (gone.length > 0 || a.length !== b.length)) fail(`${key}: ${gone.length} pinned fragment(s) no longer in the text (npm run check:paper -- --update-pins)`)
  }
}

// ---------------------------------------------------------------- figure column mappings

/** Which column of which data file every plotted curve reads: [x, y, file]. */
const PLOTS: Record<string, Array<[string, string, string]>> = {
  'figures/planner.tex': [
    ['fleetSize', 'makespan_mean', 'planner_pp.csv'],
    ['fleetSize', 'makespan_mean', 'planner_cbs.csv'],
    ['fleetSize', 'waitActions_mean', 'planner_pp.csv'],
    ['fleetSize', 'waitActions_mean', 'planner_cbs.csv'],
    ['window', 'throughput_mean', 'window.csv'],
    ['window', '10*plannerMs_median', 'window.csv'],
  ],
  'figures/scaling.tex': [
    ['fleetSize', 'throughput_mean', 'scaling_hungarian.csv'],
    ['fleetSize', 'throughput_mean', 'scaling_pact.csv'],
    ['fleetSize', 'plannerMs_median', 'scaling_hungarian.csv'],
    ['fleetSize', 'plannerMs_median', 'scaling_pact.csv'],
    ['fleetSize', 'astarCalls_mean', 'scaling_hungarian.csv'],
    ['fleetSize', 'astarCalls_mean', 'scaling_pact.csv'],
  ],
}

function checkPlots(): void {
  for (const [file, expected] of Object.entries(PLOTS)) {
    const text = norm(readFileSync(join(PAPER, file), 'utf8'))
    const found: string[] = []
    for (const m of text.matchAll(/table\[([^\]]*)\]\s*\{figures\/data\/([^}]*)\}/g)) {
      const x = /(?:^|,)\s*x=([^,]*)/.exec(m[1])?.[1].trim() ?? '?'
      const y = /y expr=([^,]*)/.exec(m[1])?.[1].replace(/\\thisrow\{([^}]*)\}/g, '$1').trim() ?? /(?:^|,)\s*y=([^,]*)/.exec(m[1])?.[1].trim() ?? '?'
      const err = /y error expr=([^,]*)/.exec(m[1])?.[1].replace(/\\thisrow\{([^}]*)\}/g, '$1').trim() ?? /y error=([^,]*)/.exec(m[1])?.[1].trim() ?? null
      // Curves of seed means carry the seed standard deviation; timing medians carry no error bar.
      if (y.endsWith('_mean') ? err !== y.replace(/_mean$/, '_std') : err !== null) fail(`${file}: error bars of ${y} read ${err}`)
      found.push([x, y, m[2]].join('|'))
    }
    const want = expected.map((e) => e.join('|'))
    if (found.join(' ') !== want.join(' ')) fail(`${file}: plotted columns are [${found.join(' ')}], expected [${want.join(' ')}]`)
  }
}

// ---------------------------------------------------------------- 5. abstract

export function plainAbstract(): string {
  let t = norm(readFileSync(join(PAPER, 'sections/0_abstract.tex'), 'utf8'))
  t = t.replace(/\\begin\{abstract\}|\\end\{abstract\}/g, '')
  t = t.replace(/\\emph\{\\sname\}/g, 'PACT').replace(/\\sname/g, 'PACT')
  t = t.replace(/\\url\{([^}]*)\}/g, '$1')
  t = t.replace(/\{,\}/g, ',').replace(/\\%/g, '%')
  t = t.replace(/\$([^$]*)\$/g, '$1').replace(/--/g, '-')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

function checkAbstract(): void {
  const t = plainAbstract()
  if (/[\\${}]/.test(t)) fail(`plain abstract still contains LaTeX: ${t.match(/.{0,20}[\\${}].{0,20}/)?.[0]}`)
  if (t.length > 1920) fail(`plain abstract has ${t.length} characters (arXiv limit 1920)`)
}

// ---------------------------------------------------------------- main

function main(): void {
  checkGenerated()
  checkSummaries()
  const all = specs()
  const prose = readdirSync(join(PAPER, 'sections')).map((f) => `sections/${f}`).concat(readdirSync(join(PAPER, 'figures')).filter((f) => f.endsWith('.tex')).map((f) => `figures/${f}`))
  for (const f of prose) if (!all.some((s) => s.file === f)) fail(`${f} is not covered by the guard`)
  for (const spec of all) checkProse(spec)
  checkPins()
  checkPlots()
  checkAbstract()
  const claims = all.reduce((a, s) => a + s.claims.length, 0)
  if (process.argv.includes('--abstract')) console.log(`${plainAbstract()}\n(${plainAbstract().length} characters)`)
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL ${f}`)
    console.error(`${failures.length} failure(s)`)
    process.exit(1)
  }
  console.log(`paper guard: ${claims} text claims in ${all.length} files, ${[...buildPaperData().files.keys()].length} generated files and ${SWEEPS.length} summaries verified; plain abstract ${plainAbstract().length} characters`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main()
