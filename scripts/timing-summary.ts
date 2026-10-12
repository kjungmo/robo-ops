/**
 * Collect the wall-clock fields of the repeats made by scripts/measure-timing.sh.
 *
 *   tsx scripts/timing-summary.ts <tmp dir with repeat-<n>/> <out dir> <attempts> <load max>
 *
 * Writes <out>/repeat-<n>.csv (one line per run) and <out>/summary.json. For
 * every configuration the summary holds the seed-mean of plannerMsPerTick in
 * each repeat and the median, minimum and maximum of that mean over the valid
 * repeats. A repeat is valid when its host-<n>.txt says so.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'

export const TIMING_SWEEPS = ['planner', 'scaling', 'ablation'] as const
type Rec = Record<string, number | string | null>

export interface TimingConfig {
  sweep: string
  layout: string
  fleetSize: number
  variant: string
  /** Seed-mean plannerMsPerTick per repeat, in repeat order (invalid repeats included). */
  perRepeat: number[]
  median: number
  min: number
  max: number
}

export interface TimingSummary {
  what: string
  commit: string
  node: string
  cpu: string
  cores: number
  workers: number
  loadMax: number
  attempts: number
  validRepeats: number[]
  invalidRepeats: number[]
  /** 1-minute load average before and after every repeat. */
  load: Array<{ repeat: number; before: number; after: number; valid: boolean }>
  configs: TimingConfig[]
}

export function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

function main(): void {
  const [tmp, out, attemptsArg, loadMaxArg] = process.argv.slice(2)
  const attempts = Number(attemptsArg)
  const load: TimingSummary['load'] = []
  const groups = new Map<string, { sweep: string; layout: string; fleetSize: number; variant: string; perRepeat: number[] }>()
  for (let n = 1; n <= attempts; n += 1) {
    const host = readFileSync(join(out, `host-${n}.txt`), 'utf8')
    const loads = [...host.matchAll(/^loadavg: (\S+)/gm)].map((m) => Number(m[1]))
    load.push({ repeat: n, before: loads[0], after: loads[1], valid: /^verdict: valid$/m.test(host) })
    const lines = ['sweep,layout,fleetSize,variant,seed,plannerMs,allocMs,plannerMsPerTick,wallMs']
    for (const sweep of TIMING_SWEEPS) {
      const file = join(tmp, `repeat-${n}`, `${sweep}.json`)
      if (!existsSync(file)) throw new Error(`missing ${file}`)
      const recs = JSON.parse(readFileSync(file, 'utf8')) as Rec[]
      const sums = new Map<string, { sum: number; count: number }>()
      for (const r of recs) {
        lines.push([sweep, r.layout, r.fleetSize, r.variant, r.seed, r.plannerMs, r.allocMs, r.plannerMsPerTick, r.wallMs].join(','))
        const key = `${sweep}|${r.layout}|${r.fleetSize}|${r.variant}`
        const s = sums.get(key) ?? { sum: 0, count: 0 }
        s.sum += Number(r.plannerMsPerTick)
        s.count += 1
        sums.set(key, s)
      }
      for (const [key, s] of sums) {
        const [sw, layout, fleet, variant] = key.split('|')
        const g = groups.get(key) ?? { sweep: sw, layout, fleetSize: Number(fleet), variant, perRepeat: [] }
        g.perRepeat.push(Number((s.sum / s.count).toFixed(5)))
        groups.set(key, g)
      }
    }
    writeFileSync(join(out, `repeat-${n}.csv`), `${lines.join('\n')}\n`)
  }
  const valid = load.filter((l) => l.valid).map((l) => l.repeat)
  const configs: TimingConfig[] = [...groups.values()].map((g) => {
    const xs = valid.map((n) => g.perRepeat[n - 1])
    return { ...g, median: xs.length ? Number(median(xs).toFixed(5)) : Number.NaN, min: Math.min(...xs), max: Math.max(...xs) }
  })
  const summary: TimingSummary = {
    what: 'Planner wall-clock time per simulated tick (ms), seed-mean per configuration, measured by scripts/measure-timing.sh in one process on a quiet host. median/min/max are over the valid repeats.',
    commit: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(),
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    workers: 1,
    loadMax: Number(loadMaxArg),
    attempts,
    validRepeats: valid,
    invalidRepeats: load.filter((l) => !l.valid).map((l) => l.repeat),
    load,
    configs,
  }
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`)
  console.log(`timing summary: ${configs.length} configurations, valid repeats ${valid.join(', ') || 'none'} of ${attempts}`)
}

if (process.argv[1] && process.argv[1].endsWith('timing-summary.ts')) main()
