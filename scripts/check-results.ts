/**
 * Compare a fresh benchmark run with the committed results.
 *
 *   npm run bench:fms -- main planner scaling ablation battery --out /tmp/rerun
 *   npm run check:results -- /tmp/rerun
 *   npm run check:results -- /tmp/rerun --report paper/experiments/repro/repeat.json
 *
 * For every <sweep>.json found in the given directory, each record is compared
 * field by field with the record at the same position in
 * paper/experiments/results/<sweep>.json. The wall-clock fields (TIMING) are
 * excluded from the comparison: they depend on the host and on its load. Every
 * other field must be identical, or the script exits with status 1.
 *
 * One schema difference is expected and reported, not counted: the committed
 * first-round files (main, planner, scaling, ablation, battery) were written
 * at commit 27080ab, before the four fields in ADDED_LATER were recorded
 * (commit 2d4342a), so a fresh run has those four fields and the committed
 * first-round records do not.
 *
 * It also prints how far the wall-clock fields moved, per sweep, so that the
 * spread of the timing columns quoted in the paper can be stated. With
 * --report <file> the same summary is written as JSON, together with the
 * commit, Node version and CPU that the fresh run recorded in its
 * bench-meta*.json files.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const TIMING = ['wallMs', 'plannerMs', 'allocMs', 'plannerMsPerTick'] as const
/** Recorded since commit 2d4342a; absent from the committed first-round records. */
export const ADDED_LATER = ['cbsBudgetExceeded', 'tpSearchLimitHits', 'tpSwapVetoes', 'audit_maxWorkTripDelay'] as const
export const FIRST_ROUND = ['main', 'planner', 'scaling', 'ablation', 'battery'] as const
const COMMITTED = join(process.cwd(), 'paper/experiments/results')
const SWEEPS = ['main', 'planner', 'scaling', 'ablation', 'battery', 'stress', 'cascade', 'baselines', 'coupling']

type Rec = Record<string, unknown>

export interface SweepDiff {
  sweep: string
  records: number
  /** Human-readable descriptions of the first differences (capped). */
  differences: string[]
  differenceCount: number
  /** Fields of ADDED_LATER that the fresh records have and the committed first-round records lack. */
  addedLater: string[]
  /** Per configuration: fresh mean plannerMsPerTick divided by the committed mean. */
  timingRatios: number[]
}

export function compareSweep(sweep: string, committed: Rec[], fresh: Rec[]): SweepDiff {
  const differences: string[] = []
  let differenceCount = 0
  const note = (msg: string) => {
    differenceCount += 1
    if (differences.length < 10) differences.push(msg)
  }
  if (committed.length !== fresh.length) note(`${sweep}: ${fresh.length} records, committed ${committed.length}`)
  const n = Math.min(committed.length, fresh.length)
  const groups = new Map<string, { a: number; b: number }>()
  const addedLater = new Set<string>()
  const firstRound = (FIRST_ROUND as readonly string[]).includes(sweep)
  for (let i = 0; i < n; i += 1) {
    const a = committed[i]
    const b = fresh[i]
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if ((TIMING as readonly string[]).includes(k)) continue
      if (firstRound && !(k in a) && k in b && (ADDED_LATER as readonly string[]).includes(k)) addedLater.add(k)
      else if (!(k in a) || !(k in b)) note(`${sweep}[${i}].${k}: field ${k in a ? 'missing in the fresh run' : 'not in the committed record'}`)
      else if (!Object.is(a[k], b[k])) note(`${sweep}[${i}] (${String(a.variant)}, seed ${String(a.seed)}).${k}: committed ${String(a[k])}, fresh ${String(b[k])}`)
    }
    const key = [a.layout, a.fleetSize, a.arrivalRate, a.variant].join('|')
    const g = groups.get(key) ?? { a: 0, b: 0 }
    g.a += Number(a.plannerMsPerTick)
    g.b += Number(b.plannerMsPerTick)
    groups.set(key, g)
  }
  const timingRatios = [...groups.values()].filter((g) => g.a > 0).map((g) => g.b / g.a)
  return { sweep, records: n, differences, differenceCount, addedLater: [...addedLater].sort(), timingRatios }
}

function main() {
  const dirArg = process.argv[2]
  if (!dirArg) {
    console.error('usage: npm run check:results -- <directory with a fresh bench run>')
    process.exit(2)
  }
  const dir = resolve(dirArg)
  if (dir === COMMITTED) {
    console.error('refusing to compare the committed results with themselves; run the bench with --out <other dir>')
    process.exit(2)
  }
  const found = existsSync(dir) ? readdirSync(dir).filter((f) => SWEEPS.includes(f.replace(/\.json$/, '')) && f.endsWith('.json')) : []
  if (found.length === 0) {
    console.error(`no <sweep>.json in ${dir}`)
    process.exit(2)
  }
  // What the fresh run recorded about itself.
  const metaOf = new Map<string, Record<string, unknown>>()
  for (const f of readdirSync(dir).filter((x) => /^bench-meta.*\.json$/.test(x))) {
    const meta = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>
    for (const sweep of meta.sweeps as string[]) metaOf.set(sweep, meta)
  }
  const report: Array<Record<string, unknown>> = []
  let bad = 0
  let total = 0
  for (const sweep of SWEEPS) {
    if (!found.includes(`${sweep}.json`)) continue
    const committed = JSON.parse(readFileSync(join(COMMITTED, `${sweep}.json`), 'utf8')) as Rec[]
    const fresh = JSON.parse(readFileSync(join(dir, `${sweep}.json`), 'utf8')) as Rec[]
    const d = compareSweep(sweep, committed, fresh)
    total += d.records
    bad += d.differenceCount
    const r = d.timingRatios
    const sorted = [...r].sort((x, y) => x - y)
    const timing = r.length ? `planner ms/tick, fresh/committed per configuration: min ${sorted[0].toFixed(2)}, median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}, max ${sorted[sorted.length - 1].toFixed(2)}` : ''
    console.log(`${sweep}: ${d.records} records, ${d.differenceCount} differing non-timing fields; ${timing}`)
    if (d.addedLater.length) console.log(`  fields recorded since 2d4342a, absent from the committed ${sweep} records (expected): ${d.addedLater.join(', ')}`)
    for (const line of d.differences) console.log(`  ${line}`)
    const meta = metaOf.get(sweep)
    report.push({
      sweep,
      records: d.records,
      differingFields: d.differenceCount,
      fieldsAbsentFromCommitted: d.addedLater,
      workers: meta ? meta.workers : null,
      timingMin: r.length ? Number(sorted[0].toFixed(4)) : null,
      timingMedian: r.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(4)) : null,
      timingMax: r.length ? Number(sorted[sorted.length - 1].toFixed(4)) : null,
    })
  }
  const ri = process.argv.indexOf('--report')
  if (ri >= 0 && process.argv[ri + 1]) {
    const metas = [...new Set(metaOf.values())]
    const uniq = (k: string) => [...new Set(metas.map((m) => String(m[k])))].join(', ')
    const out = {
      what: 'Repeat of the benchmark compared with the committed records by scripts/check-results.ts; timing* is the per-configuration mean plannerMsPerTick of the repeat divided by the committed mean.',
      commit: uniq('commit'),
      node: uniq('node'),
      cpu: uniq('cpu'),
      dates: metas.map((m) => String(m.date)).sort(),
      excludedFields: TIMING,
      records: total,
      differingFields: bad,
      sweeps: report,
    }
    const target = resolve(process.argv[ri + 1])
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`)
    console.log(`report written to ${target}`)
  }
  console.log(`${total} records compared (${TIMING.join(', ')} excluded): ${bad === 0 ? 'identical' : `${bad} differences`}`)
  process.exit(bad === 0 ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main()
