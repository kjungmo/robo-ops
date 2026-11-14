/**
 * Collect the wall-clock fields of the repeats made by scripts/measure-timing.sh.
 *
 *   tsx scripts/timing-summary.ts <tmp dir with repeat-<n>/> <out dir> <attempts> <load max>
 *
 * Writes <out>/repeat-<n>.csv (one line per run) and <out>/summary.json. For
 * every configuration the summary holds the seed-mean of plannerMsPerTick in
 * each repeat and the median, minimum and maximum of that mean over the valid
 * repeats. A repeat is valid when its host-<n>.txt says so.
 *
 * The summary also holds `epochConfigs`: per configuration, the wall time of one
 * rolling-horizon epoch (p50, p99 and max over all epochs of all seeds of a
 * repeat, from <tmp>/repeat-<n>/epoch-times.json) for the sweeps in EPOCH_SWEEPS,
 * and the seed-mean planner ms/tick of the same runs. A percentile q of the n
 * sorted epoch times is element min(n - 1, floor(q * n)); max is element n - 1.
 * Epoch times exclude the time of the diagnostic counters (see diagMs in
 * src/fms/sim/simulator.ts). The `configs` list is unchanged by this.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'

export const TIMING_SWEEPS = ['planner', 'scaling', 'ablation'] as const
/** Sweeps whose epoch times are summarised: the three above and the timing-only sweep of bench-fms.ts. */
export const EPOCH_SWEEPS = [...TIMING_SWEEPS, 'epochtime'] as const
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

export interface EpochStat {
  /** Per repeat, in repeat order (invalid repeats included). */
  perRepeat: number[]
  /** Median over the valid repeats. */
  median: number
  /** Largest over the valid repeats. */
  max: number
}

export interface EpochConfig {
  sweep: string
  layout: string
  fleetSize: number
  variant: string
  /** Epochs per repeat (all seeds pooled), first valid repeat. */
  epochs: number
  p50: EpochStat
  p99: EpochStat
  /** Longest single epoch of the repeat. */
  maxEpoch: EpochStat
  /** Seed-mean planner ms per tick of the same runs, per repeat; median and max over the valid repeats. */
  msPerTick: EpochStat
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
  epochConfigs: EpochConfig[]
}

export function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
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
  const epochGroups = new Map<string, { sweep: string; layout: string; fleetSize: number; variant: string; epochs: number; p50: number[]; p99: number[]; maxEpoch: number[]; msPerTick: number[] }>()
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
    // Epoch times of this repeat, pooled over the seeds of a configuration.
    const epochFile = join(tmp, `repeat-${n}`, 'epoch-times.json')
    if (existsSync(epochFile)) {
      const epochs = JSON.parse(readFileSync(epochFile, 'utf8')) as Record<string, number[]>
      for (const sweep of EPOCH_SWEEPS) {
        const file = join(tmp, `repeat-${n}`, `${sweep}.json`)
        if (!existsSync(file)) continue
        const recs = JSON.parse(readFileSync(file, 'utf8')) as Rec[]
        const ms = new Map<string, { sum: number; count: number }>()
        for (const r of recs) {
          const key = `${sweep}|${r.layout}|${r.fleetSize}|${r.variant}`
          const s = ms.get(key) ?? { sum: 0, count: 0 }
          s.sum += Number(r.plannerMsPerTick)
          s.count += 1
          ms.set(key, s)
        }
        for (const [key, s] of ms) {
          const xs = [...(epochs[key] ?? [])].sort((a, b) => a - b)
          if (xs.length === 0) throw new Error(`no epoch times for ${key} in ${epochFile}`)
          const [sw, layout, fleet, variant] = key.split('|')
          const g = epochGroups.get(key) ?? { sweep: sw, layout, fleetSize: Number(fleet), variant, epochs: xs.length, p50: [], p99: [], maxEpoch: [], msPerTick: [] }
          g.p50.push(Number(quantile(xs, 0.5).toFixed(4)))
          g.p99.push(Number(quantile(xs, 0.99).toFixed(4)))
          g.maxEpoch.push(Number(xs[xs.length - 1].toFixed(4)))
          g.msPerTick.push(Number((s.sum / s.count).toFixed(5)))
          epochGroups.set(key, g)
        }
      }
    }
  }
  const valid = load.filter((l) => l.valid).map((l) => l.repeat)
  const configs: TimingConfig[] = [...groups.values()].map((g) => {
    const xs = valid.map((n) => g.perRepeat[n - 1])
    return { ...g, median: xs.length ? Number(median(xs).toFixed(5)) : Number.NaN, min: Math.min(...xs), max: Math.max(...xs) }
  })
  const stat = (perRepeat: number[]): EpochStat => {
    const xs = valid.map((n) => perRepeat[n - 1])
    return { perRepeat, median: xs.length ? Number(median(xs).toFixed(4)) : Number.NaN, max: xs.length ? Math.max(...xs) : Number.NaN }
  }
  const epochConfigs: EpochConfig[] = [...epochGroups.values()].map((g) => ({
    sweep: g.sweep,
    layout: g.layout,
    fleetSize: g.fleetSize,
    variant: g.variant,
    epochs: g.epochs,
    p50: stat(g.p50),
    p99: stat(g.p99),
    maxEpoch: stat(g.maxEpoch),
    msPerTick: stat(g.msPerTick),
  }))
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
    epochConfigs,
  }
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`)
  console.log(`timing summary: ${configs.length} configurations, ${epochConfigs.length} with epoch times, valid repeats ${valid.join(', ') || 'none'} of ${attempts}`)
}

if (process.argv[1] && process.argv[1].endsWith('timing-summary.ts')) main()
