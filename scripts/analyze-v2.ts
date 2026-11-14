/**
 * Statistics of the three v2 sweeps, exactly as fixed in paper/experiments/PREREG_v2.md.
 *
 *   npm run analyze:v2                      # reads paper/experiments/results, writes paper/experiments/analysis/v2.json
 *   npx tsx scripts/analyze-v2.ts --check   # recompute and compare with the committed v2.json (no write)
 *
 * Effect size, interval and test are those of the paper (paired() of scripts/paper-data.ts): the
 * mean per-seed relative difference in percent, a two-sided 95 % Student-t interval over the 30
 * seed pairs, and the two-sided paired t test. Multiplicity: Holm at 0.05 over the family that
 * PREREG_v2.md names for the experiment. The output is deterministic given the records.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { holm } from './stats'
import { paired, readRuns, type Paired, type Run } from './paper-data'

const OUT = join(process.cwd(), 'paper/experiments/analysis/v2.json')
const ALLOCS = ['greedy', 'hungarian', 'pact-proxy', 'pact'] as const

const num = (r: Run, k: string) => Number(r[k])
const sum = (rs: Run[], k: string) => rs.reduce((a, r) => a + num(r, k), 0)
const mean = (rs: Run[], k: string) => sum(rs, k) / rs.length
const sd = (rs: Run[], k: string) => {
  const m = mean(rs, k)
  return Math.sqrt(rs.reduce((a, r) => a + (num(r, k) - m) ** 2, 0) / (rs.length - 1))
}
const r4 = (x: number) => Number(x.toFixed(4))

export interface Contrast {
  id: string
  label: string
  metric: string
  a: string
  b: string
  n: number
  mean: number
  half: number
  lo: number
  hi: number
  p: number
  family: string
  /** Holm decision over `family`; null for a contrast that is outside every family (reference). */
  holmReject: boolean | null
}

type Pending = Omit<Contrast, 'holmReject'>

function contrast(id: string, label: string, metric: string, a: string, b: string, ra: Run[], rb: Run[], family: string): Pending {
  const p: Paired = paired(ra, rb, metric)
  return { id, label, metric, a, b, n: p.n, mean: r4(p.mean), half: r4(p.half), lo: r4(p.mean - p.half), hi: r4(p.mean + p.half), p: Number(p.p.toPrecision(6)), family }
}

/** Holm within every named family (contrasts with family '' would stay undecided; none is left). */
function decide(list: Pending[]): Contrast[] {
  const out: Contrast[] = list.map((c) => ({ ...c, holmReject: null }))
  for (const fam of new Set(list.map((c) => c.family).filter((f) => f !== ''))) {
    const idx = out.map((c, i) => (c.family === fam ? i : -1)).filter((i) => i >= 0)
    const rej = holm(idx.map((i) => out[i].p))
    idx.forEach((i, j) => (out[i].holmReject = rej[j]))
  }
  return out
}

/** Mean and interval of an arbitrary per-seed vector (the interaction test). */
function pairedVector(xs: number[]): Paired {
  // A Run pair with the vector as the "relative difference": reuse paired() on constructed runs.
  const a: Run[] = xs.map((x, i) => ({ seed: i + 1, v: 100 + x }))
  const b: Run[] = xs.map((_, i) => ({ seed: i + 1, v: 100 }))
  return paired(a, b, 'v')
}

const bySeed = (rs: Run[]) => [...rs].sort((x, y) => num(x, 'seed') - num(y, 'seed'))

interface CellStats {
  variant: string
  n: number
  throughput: { mean: number; sd: number }
  meanServiceTime: { mean: number; sd: number }
  makespan: number
  waitActions: number
  stalledRuns: number
  unfinishedTasks: number
  executedConflicts: number
  illegalMoves: number
  depletions: number
  holdEventsMean: number
  allocCalls: number
  nondegenerateShare: number
  greedyEqHungarianShare: number
  matchDiffer: number
  matchDifferNondegenerate: number
  cplAllocs: number
  cplPairsPerCall: number
}

function cellStats(variant: string, rs: Run[]): CellStats {
  const calls = sum(rs, 'allocCalls')
  return {
    variant,
    n: rs.length,
    throughput: { mean: r4(mean(rs, 'throughput')), sd: r4(sd(rs, 'throughput')) },
    meanServiceTime: { mean: r4(mean(rs, 'meanServiceTime')), sd: r4(sd(rs, 'meanServiceTime')) },
    makespan: r4(mean(rs, 'makespan')),
    waitActions: r4(mean(rs, 'waitActions')),
    stalledRuns: sum(rs, 'deadlocked'),
    unfinishedTasks: sum(rs, 'tasksUnfinished'),
    executedConflicts: sum(rs, 'audit_vertexConflicts') + sum(rs, 'audit_swapConflicts'),
    illegalMoves: sum(rs, 'audit_illegalMoves'),
    depletions: sum(rs, 'depletionEvents'),
    holdEventsMean: r4(mean(rs, 'holdEvents')),
    allocCalls: calls,
    nondegenerateShare: r4((100 * sum(rs, 'allocNondegenerate')) / calls),
    greedyEqHungarianShare: r4((100 * sum(rs, 'allocGreedyEqHungarian')) / calls),
    matchDiffer: sum(rs, 'cplAllocsMatchDiffer'),
    matchDifferNondegenerate: sum(rs, 'cplAllocsMatchDifferNondegenerate'),
    cplAllocs: sum(rs, 'cplAllocs'),
    cplPairsPerCall: r4(sum(rs, 'cplPairs') / calls),
  }
}

// ---------------------------------------------------------------- E2

function analyseE2(abl: Run[]) {
  const runs = readRuns('nondegenerate.json')
  const cells = ['warehouse-32-batch', 'console-32-batch']
  const arms = ['noevent', 'event', 'noevent-dock4']
  const sel = (cell: string, arm: string, alloc: string) => bySeed(runs.filter((r) => r.variant === `${cell}/${arm}/${alloc}`))
  const stats: CellStats[] = []
  for (const cell of cells) for (const arm of arms) for (const a of ALLOCS) stats.push(cellStats(`${cell}/${arm}/${a}`, sel(cell, arm, a)))
  const list: Pending[] = []
  // Primary family: PACT vs Hungarian, no event epochs, throughput.
  const prim = 'E2 primary (Holm over 2)'
  cells.forEach((cell, i) => list.push(contrast(`P2${'ab'[i]}`, `${cell}, noevent: pact vs hungarian`, 'throughput', 'pact', 'hungarian', sel(cell, 'noevent', 'pact'), sel(cell, 'noevent', 'hungarian'), prim)))
  // Secondary family: the other contrasts of the three arms (Holm over all of them).
  const sec = 'E2 secondary (Holm over all secondary contrasts)'
  for (const cell of cells) {
    for (const arm of arms) {
      const contrasts: Array<[string, string]> = [
        ['pact-proxy', 'hungarian'],
        ['greedy', 'hungarian'],
        ['pact', 'greedy'],
        ...(arm === 'noevent' ? [] : ([['pact', 'hungarian']] as Array<[string, string]>)),
      ]
      for (const [a, b] of contrasts) {
        for (const metric of ['throughput', 'meanServiceTime']) {
          list.push(contrast(`S2 ${cell} ${arm} ${a}-${b} ${metric}`, `${cell}, ${arm}: ${a} vs ${b}`, metric, a, b, sel(cell, arm, a), sel(cell, arm, b), sec))
        }
      }
      if (arm === 'noevent') {
        list.push(contrast(`S2 ${cell} noevent pact-hungarian meanServiceTime`, `${cell}, noevent: pact vs hungarian`, 'meanServiceTime', 'pact', 'hungarian', sel(cell, arm, 'pact'), sel(cell, arm, 'hungarian'), sec))
      }
    }
  }
  // Interaction: relative effect of PACT vs Hungarian without event epochs minus with them, per seed.
  const inter = cells.map((cell) => {
    const rel = (arm: string) => {
      const pa = sel(cell, arm, 'pact')
      const hu = sel(cell, arm, 'hungarian')
      return pa.map((r, i) => (100 * (num(r, 'throughput') - num(hu[i], 'throughput'))) / num(hu[i], 'throughput'))
    }
    const ne = rel('noevent')
    const ev = rel('event')
    const p = pairedVector(ne.map((x, i) => x - ev[i]))
    return { cell, meanNoEvent: r4(ne.reduce((a, b) => a + b, 0) / ne.length), meanEvent: r4(ev.reduce((a, b) => a + b, 0) / ev.length), difference: r4(p.mean), half: r4(p.half), lo: r4(p.mean - p.half), hi: r4(p.mean + p.half), p: Number(p.p.toPrecision(6)), n: p.n }
  })
  // Consistency with the v1 ablation (seeds 1-5, warehouse-32-batch, same configuration).
  const check: Array<{ ablation: string; alloc: string; seeds: number; identical: boolean }> = []
  for (const [variant, alloc] of [['pact-noEvent', 'pact'], ['hungarian-noEvent', 'hungarian']] as const) {
    const a = bySeed(abl.filter((r) => r.variant === variant))
    const b = sel('warehouse-32-batch', 'noevent', alloc).filter((r) => num(r, 'seed') <= 5)
    const same = a.length === b.length && a.every((r, i) => ['makespan', 'throughput', 'meanServiceTime', 'moveActions', 'waitActions', 'cplAllocsMatchDiffer'].every((k) => Object.is(r[k], b[i][k])))
    check.push({ ablation: variant, alloc, seeds: a.length, identical: same })
  }
  return { cells: stats, contrasts: decide(list), interaction: inter, ablationConsistency: check }
}

// ---------------------------------------------------------------- E3

function analyseE3() {
  const runs = readRuns('kablation.json')
  const cells = ['warehouse-8-batch', 'narrow-16-batch']
  const sel = (cell: string, K: number) => bySeed(runs.filter((r) => r.variant === `${cell}/pact-K${K}`))
  const stats: CellStats[] = []
  const list: Pending[] = []
  const fam = 'E3 primary (Holm over 4)'
  const identical: Array<{ cell: string; K: number; seedsEqualToK6: number; of: number }> = []
  for (const cell of cells) {
    for (const K of [3, 6, 12]) stats.push(cellStats(`${cell}/pact-K${K}`, sel(cell, K)))
    for (const K of [3, 12]) {
      list.push(contrast(`P3 ${cell} K${K}-K6`, `${cell}: K=${K} vs K=6`, 'throughput', `pact-K${K}`, 'pact-K6', sel(cell, K), sel(cell, 6), fam))
      list.push(contrast(`S3 ${cell} K${K}-K6 service`, `${cell}: K=${K} vs K=6`, 'meanServiceTime', `pact-K${K}`, 'pact-K6', sel(cell, K), sel(cell, 6), 'E3 secondary (Holm over 4)'))
      const a = sel(cell, K)
      const b = sel(cell, 6)
      identical.push({ cell, K, seedsEqualToK6: a.filter((r, i) => ['makespan', 'throughput', 'moveActions', 'waitActions', 'cplPairs', 'cplAllocsMatchDiffer'].every((k) => Object.is(r[k], b[i][k]))).length, of: a.length })
    }
  }
  return { cells: stats, contrasts: decide(list), identicalToK6: identical }
}

// ---------------------------------------------------------------- E4

function analyseE4() {
  const split = readRuns('prioritysplit.json')
  const casc = readRuns('cascade.json')
  const settings = ['warehouse-32', 'warehouse-32-dock4', 'small-8', 'narrow-16']
  const pick = (setting: string, arm: string) => bySeed(arm === 'held' || arm === 'blocking' ? split.filter((r) => r.variant === `${setting}/${arm}`) : casc.filter((r) => r.variant === `${setting}/${arm}`))
  // Arm names: dynamic = the cascade sweep's 'cascade' variant (both mechanisms); static = 'static' (neither).
  const recordArm = (arm: string) => (arm === 'dynamic' ? 'cascade' : arm)
  const stats: CellStats[] = []
  const list: Pending[] = []
  const prim = 'E4 primary (Holm over 8)'
  for (const s of settings) {
    for (const arm of ['dynamic', 'static', 'held', 'blocking']) stats.push(cellStats(`${s}/${arm}`, pick(s, recordArm(arm))))
    for (const arm of ['held', 'blocking']) list.push(contrast(`P4 ${s} ${arm}-static`, `${s}: ${arm}-only vs static`, 'throughput', arm, 'static', pick(s, arm), pick(s, 'static'), prim))
    for (const arm of ['held', 'blocking']) list.push(contrast(`S4 ${s} ${arm}-dynamic`, `${s}: ${arm}-only vs dynamic`, 'throughput', arm, 'dynamic', pick(s, arm), pick(s, 'cascade'), 'E4 secondary (Holm over 12)'))
    list.push(contrast(`S4 ${s} dynamic-static`, `${s}: dynamic vs static (reference)`, 'throughput', 'dynamic', 'static', pick(s, 'cascade'), pick(s, 'static'), 'E4 secondary (Holm over 12)'))
  }
  const contrasts = decide(list)
  // The decision rule of PREREG_v2.md E4, per setting.
  const get = (id: string) => contrasts.find((c) => c.id === id) as Contrast
  const excl0 = (c: Contrast) => c.lo > 0 || c.hi < 0
  const contains0 = (c: Contrast) => !excl0(c)
  const rules = settings.map((s) => {
    const ds = get(`S4 ${s} dynamic-static`)
    const hs = get(`P4 ${s} held-static`)
    const bs = get(`P4 ${s} blocking-static`)
    const hd = get(`S4 ${s} held-dynamic`)
    const bd = get(`S4 ${s} blocking-dynamic`)
    const heldRecovers = hs.holmReject === true && hs.mean > 0 && contains0(hd)
    const blockRecovers = bs.holmReject === true && bs.mean > 0 && contains0(bd)
    let verdict: string
    if (!(excl0(ds) && ds.mean > 0)) verdict = 'no attribution (dynamic vs static does not exclude zero on the positive side)'
    else if (heldRecovers && blockRecovers) verdict = 'either mechanism suffices'
    else if (heldRecovers) verdict = 'held-first accounts for the advantage'
    else if (blockRecovers) verdict = 'blocking-first accounts for the advantage'
    else verdict = 'the advantage needs the combination'
    return { setting: s, dynamicVsStatic: { mean: ds.mean, lo: ds.lo, hi: ds.hi }, heldRecovers, blockRecovers, verdict }
  })
  return { cells: stats, contrasts, rules }
}

export function analyseV2() {
  const abl = readRuns('ablation.json')
  return {
    what: 'Statistics of the sweeps nondegenerate, kablation and prioritysplit as fixed in paper/experiments/PREREG_v2.md. Mean and interval: mean per-seed relative difference in percent with a two-sided 95 % Student-t interval (29 degrees of freedom); p: two-sided paired t test; Holm at 0.05 within the named family.',
    preregistration: 'paper/experiments/PREREG_v2.md',
    /** The commit that added PREREG_v2.md and nothing else, before any of these results existed. */
    preregistrationCommit: 'f35437f',
    e2: analyseE2(abl),
    e3: analyseE3(),
    e4: analyseE4(),
  }
}

function main() {
  const text = `${JSON.stringify(analyseV2(), null, 1)}\n`
  if (process.argv.includes('--check')) {
    const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (committed !== text) {
      console.error('paper/experiments/analysis/v2.json differs from a fresh computation; run npm run analyze:v2')
      process.exit(1)
    }
    console.log('v2 analysis: identical to the committed file')
    return
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, text)
  console.log(`written ${OUT}`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main()
