/**
 * Derive every table and figure data file of the paper from the committed
 * benchmark results, so that each number in paper/arxiv traces to
 * paper/experiments/results/<sweep>_summary.csv (see paper/arxiv/NUMBERS.md).
 *
 *   npx tsx scripts/paper-data.ts
 *
 * Writes paper/arxiv/tables/*.tex and paper/arxiv/figures/data/*.csv.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DistanceOracle, chargerSlots, loadLayout, DEFAULT_BATTERY, DEFAULT_CONFIG } from '../src/fms/index'

const RESULTS = join(process.cwd(), 'paper/experiments/results')
const PAPER = join(process.cwd(), 'paper/arxiv')

type Row = Record<string, string>

function readCsv(name: string): Row[] {
  const text = readFileSync(join(RESULTS, name), 'utf8').trim()
  const [head, ...lines] = text.split('\n')
  const cols = head.split(',')
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])))
}

const num = (r: Row, k: string) => Number(r[k])
const f1 = (x: number) => x.toFixed(1)
const f0 = (x: number) => x.toFixed(0)
const f2 = (x: number) => x.toFixed(2)
const ms = (r: Row, k: string, f: (x: number) => string = f1) => `${f(num(r, `${k}_mean`))}\\stdv{${f(num(r, `${k}_std`))}}`

const METHODS = ['greedy', 'hungarian', 'pact-proxy', 'pact'] as const
const METHOD_LABEL: Record<string, string> = { greedy: 'Greedy', hungarian: 'Hungarian', 'pact-proxy': 'Proxy', pact: '\\sname' }

function mainTable(rows: Row[]): string {
  const layouts = ['warehouse', 'console']
  const fleets = [8, 16, 32]
  const rates = ['0.15', 'inf']
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Allocation methods across layouts, fleet sizes and load regimes.} Throughput (delivered tasks per 100 ticks) and mean service time (ticks from arrival to delivery), mean\\stdv{std} over 5 seeds, 200 tasks per run, prioritized planning with $w{=}20$, $h{=}5$. Load $\\lambda{=}0.15$ is a Poisson stream of 0.15 tasks/tick; \\emph{batch} releases all 200 tasks at $t{=}0$. Best mean per row in bold; seed-paired differences with 95\\% intervals are in \\cref{tab:paired}.}',
  )
  out.push('\\label{tab:main}')
  out.push('\\small')
  out.push('\\setlength{\\tabcolsep}{4pt}')
  out.push('\\begin{tabular}{llr' + 'c'.repeat(8) + '}')
  out.push('\\toprule')
  out.push('& & & \\multicolumn{4}{c}{\\textbf{Throughput} (tasks / 100 ticks) $\\uparrow$} & \\multicolumn{4}{c}{\\textbf{Service time} (ticks) $\\downarrow$}\\\\')
  out.push('\\cmidrule(lr){4-7}\\cmidrule(lr){8-11}')
  out.push('\\textbf{Layout} & \\textbf{Load} & $|\\mathcal{R}|$ & ' + METHODS.map((m) => METHOD_LABEL[m]).join(' & ') + ' & ' + METHODS.map((m) => METHOD_LABEL[m]).join(' & ') + '\\\\')
  out.push('\\midrule')
  for (const layout of layouts) {
    for (const rate of rates) {
      for (const fleet of fleets) {
        const cells = METHODS.map((m) =>
          rows.find((r) => r.layout === layout && r.arrivalRate === rate && num(r, 'fleetSize') === fleet && r.variant === m),
        )
        if (cells.some((c) => !c)) throw new Error(`missing main row ${layout} ${rate} ${fleet}`)
        const rs = cells as Row[]
        const bestT = Math.max(...rs.map((r) => num(r, 'throughput_mean')))
        const bestS = Math.min(...rs.map((r) => num(r, 'meanServiceTime_mean')))
        const tCells = rs.map((r) => (num(r, 'throughput_mean') === bestT ? `\\textbf{${f1(num(r, 'throughput_mean'))}}\\stdv{${f1(num(r, 'throughput_std'))}}` : ms(r, 'throughput')))
        const sCells = rs.map((r) => (num(r, 'meanServiceTime_mean') === bestS ? `\\textbf{${f0(num(r, 'meanServiceTime_mean'))}}\\stdv{${f0(num(r, 'meanServiceTime_std'))}}` : ms(r, 'meanServiceTime', f0)))
        const loadLabel = rate === 'inf' ? 'batch' : `$\\lambda{=}${rate}$`
        out.push(`${layout} & ${loadLabel} & ${fleet} & ${tCells.join(' & ')} & ${sCells.join(' & ')}\\\\`)
      }
    }
    if (layout === 'warehouse') out.push('\\midrule')
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  return out.join('\n') + '\n'
}

function plannerTable(rows: Row[]): string {
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Planner backend on the small layout} (batch load, 100 tasks, Hungarian allocation, 5 seeds). Windowed CBS resolves conflicts inside the window optimally and falls back to prioritized planning (PP) when its node budget (2000) is exceeded.}',
  )
  out.push('\\label{tab:planner}')
  out.push('\\small')
  out.push('\\begin{tabular}{rlccccc}')
  out.push('\\toprule')
  out.push('$|\\mathcal{R}|$ & \\textbf{Planner} & \\textbf{Makespan} $\\downarrow$ & \\textbf{Service time} $\\downarrow$ & \\textbf{Wait actions} $\\downarrow$ & \\textbf{Planner ms/tick} & \\textbf{CBS fallbacks}\\\\')
  out.push('\\midrule')
  for (const fleet of [4, 6, 8]) {
    for (const mapf of ['pp', 'cbs']) {
      const r = rows.find((x) => num(x, 'fleetSize') === fleet && x.variant === mapf)
      if (!r) throw new Error(`missing planner row ${fleet} ${mapf}`)
      const other = rows.find((x) => num(x, 'fleetSize') === fleet && x.variant !== mapf) as Row
      const bold = (k: string, lowerBetter = true) => {
        const a = num(r, `${k}_mean`)
        const b = num(other, `${k}_mean`)
        const best = lowerBetter ? a <= b : a >= b
        const v = k === 'plannerMsPerTick' ? ms(r, k, f2) : k === 'makespan' || k === 'waitActions' ? ms(r, k, f0) : ms(r, k)
        return best ? `\\textbf{${f0(a)}}\\stdv{${f0(num(r, `${k}_std`))}}` : v
      }
      out.push(
        `${mapf === 'pp' ? fleet : ''} & ${mapf === 'pp' ? 'PP' : 'Windowed CBS'} & ${bold('makespan')} & ${bold('meanServiceTime')} & ${bold('waitActions')} & ${ms(r, 'plannerMsPerTick', f2)} & ${mapf === 'cbs' ? ms(r, 'cbsFallbacks') : '--'}\\\\`,
      )
    }
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  return out.join('\n') + '\n'
}

function ablationTable(rows: Row[]): string {
  const order: Array<[string, string]> = [
    ['pact', '\\sname\\ (default: $w{=}20$, $h{=}5$, $K{=}6$, $\\kappa_{\\mathrm{d}}{=}3$, $w_{\\mathrm{b}}{=}1$)'],
    ['pact-noBattery', '\\quad no battery term ($w_{\\mathrm{b}}{=}0$)'],
    ['hungarian-noBattery', '\\quad Hungarian, no battery term'],
    ['pact-K3', '\\quad candidates $K{=}3$'],
    ['pact-K12', '\\quad candidates $K{=}12$'],
    ['pact-w10', '\\quad window $w{=}10$'],
    ['pact-w30', '\\quad window $w{=}30$'],
    ['pact-h1', '\\quad replan every tick ($h{=}1$)'],
    ['pact-noEvent', '\\quad no event-triggered epochs'],
    ['hungarian-noEvent', '\\quad Hungarian, no event-triggered epochs'],
    ['pact-dock2', '\\quad dock capacity $\\kappa_{\\mathrm{d}}{=}2$'],
    ['hungarian-dock2', '\\quad Hungarian, dock capacity $\\kappa_{\\mathrm{d}}{=}2$'],
  ]
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Ablations} on the warehouse layout with 32 robots under batch load (200 tasks, 5 seeds). Each row changes one setting of the default configuration.}',
  )
  out.push('\\label{tab:ablation}')
  out.push('\\scriptsize')
  out.push('\\begin{tabular}{lccccc}')
  out.push('\\toprule')
  out.push('\\textbf{Variant} & \\textbf{Throughput} $\\uparrow$ & \\textbf{Service time} $\\downarrow$ & \\textbf{Wait actions} & \\textbf{Holds} & \\textbf{Planner ms/tick}\\\\')
  out.push('\\midrule')
  for (const [variant, label] of order) {
    const r = rows.find((x) => x.variant === variant)
    if (!r) throw new Error(`missing ablation row ${variant}`)
    out.push(`${label} & ${ms(r, 'throughput')} & ${ms(r, 'meanServiceTime', f0)} & ${ms(r, 'waitActions', f0)} & ${ms(r, 'holdEvents')} & ${ms(r, 'plannerMsPerTick', f2)}\\\\`)
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  return out.join('\n') + '\n'
}

function batteryTable(rows: Row[]): string {
  const order: Array<[string, string]> = [
    ['hungarian', 'Hungarian'],
    ['hungarian-noBattery', 'Hungarian, $w_{\\mathrm{b}}{=}0$'],
    ['pact', '\\sname'],
    ['pact-noBattery', '\\sname, $w_{\\mathrm{b}}{=}0$'],
  ]
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Battery stress}: warehouse, 16 robots, batch load, initial charge drawn from $[0.2,0.4]$ so that every robot must charge during the run (5 seeds).}',
  )
  out.push('\\label{tab:battery}')
  out.push('\\small')
  out.push('\\begin{tabular}{lccccc}')
  out.push('\\toprule')
  out.push('\\textbf{Variant} & \\textbf{Throughput} & \\textbf{Service time} & \\textbf{Charging sessions} & \\textbf{Depletions} & \\textbf{Final mean SoC}\\\\')
  out.push('\\midrule')
  for (const [variant, label] of order) {
    const r = rows.find((x) => x.variant === variant)
    if (!r) throw new Error(`missing battery row ${variant}`)
    out.push(`${label} & ${ms(r, 'throughput')} & ${ms(r, 'meanServiceTime', f0)} & ${ms(r, 'chargeSessions')} & ${f0(num(r, 'depletionEvents_mean'))} & ${ms(r, 'finalMeanSoc', f2)}\\\\`)
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  return out.join('\n') + '\n'
}

function scalingTable(rows: Row[]): string {
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push('\\caption{\\textbf{Fleet-size scaling} on the warehouse layout under batch load (200 tasks, 5 seeds); data of \\cref{fig:scaling}.}')
  out.push('\\label{tab:scaling}')
  out.push('\\footnotesize')
  out.push('\\begin{tabular}{rlcccccc}')
  out.push('\\toprule')
  out.push('$|\\mathcal{R}|$ & \\textbf{Alloc.} & \\textbf{Throughput} & \\textbf{Service time} & \\textbf{Utilisation} & \\textbf{Wait actions} & \\textbf{A* calls} & \\textbf{Planner ms/tick}\\\\')
  out.push('\\midrule')
  for (const fleet of [4, 8, 16, 24, 32, 40, 48]) {
    for (const alloc of ['hungarian', 'pact']) {
      const r = rows.find((x) => num(x, 'fleetSize') === fleet && x.variant === alloc)
      if (!r) throw new Error(`missing scaling row ${fleet} ${alloc}`)
      out.push(
        `${alloc === 'hungarian' ? fleet : ''} & ${METHOD_LABEL[alloc]} & ${ms(r, 'throughput')} & ${ms(r, 'meanServiceTime', f0)} & ${ms(r, 'utilization', f2)} & ${ms(r, 'waitActions', f0)} & ${ms(r, 'astarCalls', f0)} & ${ms(r, 'plannerMsPerTick', f2)}\\\\`,
      )
    }
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  return out.join('\n') + '\n'
}

function seriesCsv(rows: Row[], filter: (r: Row) => boolean, xKey: string, cols: string[]): string {
  const sel = rows.filter(filter).sort((a, b) => num(a, xKey) - num(b, xKey))
  const head = [xKey, ...cols.flatMap((c) => [`${c}_mean`, `${c}_std`])]
  const lines = [head.join(',')]
  for (const r of sel) lines.push(head.map((h) => r[h]).join(','))
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------- paired analysis
// Runs with the same seed see the same task stream (arrival times, pickups,
// docks) and the same initial charge, because the simulator draws random
// numbers only for those. Differences between variants are therefore paired by
// seed; we report the mean per-seed relative difference and a two-sided 95%
// Student-t interval with n-1 = 4 degrees of freedom.

type Run = Record<string, number | string | null>

function readRuns(name: string): Run[] {
  return JSON.parse(readFileSync(join(RESULTS, name), 'utf8')) as Run[]
}

// Two-sided 95% Student-t quantiles keyed by the number of pairs n (df = n - 1).
const T975: Record<number, number> = {
  2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262,
  11: 2.228, 12: 2.201, 13: 2.179, 14: 2.16, 15: 2.145, 16: 2.131, 17: 2.12, 18: 2.11, 19: 2.101, 20: 2.093,
  21: 2.086, 22: 2.08, 23: 2.074, 24: 2.069, 25: 2.064, 26: 2.06, 27: 2.056, 28: 2.052, 29: 2.048, 30: 2.045,
  60: 2.001, 120: 1.98,
}

interface Paired {
  mean: number
  half: number
  n: number
}

function paired(a: Run[], b: Run[], key: string): Paired {
  const bySeed = new Map(b.map((r) => [r.seed, r]))
  const rel: number[] = []
  for (const r of a) {
    const o = bySeed.get(r.seed)
    if (!o) throw new Error(`unpaired seed ${r.seed}`)
    rel.push((100 * (Number(r[key]) - Number(o[key]))) / Number(o[key]))
  }
  const n = rel.length
  const mean = rel.reduce((x, y) => x + y, 0) / n
  const sd = Math.sqrt(rel.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1))
  if (T975[n] === undefined) throw new Error(`no t quantile for n=${n}`)
  return { mean, half: (T975[n] * sd) / Math.sqrt(n), n }
}

const fmtCi = (p: Paired) => {
  const m = Math.abs(p.mean) < 0.05 ? '0.0' : `${p.mean > 0 ? '+' : '-'}${Math.abs(p.mean).toFixed(1)}`
  return `$${m}\\pm${p.half.toFixed(1)}$`
}

function pairedTable(): { tex: string; summary: string } {
  const main = readRuns('main.json')
  const abl = readRuns('ablation.json')
  const plan = readRuns('planner.json')
  const rateKey = (r: Run) => (r.arrivalRate === null ? 'inf' : String(r.arrivalRate))
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Seed-paired differences.} Mean per-seed relative difference in \\%, with a two-sided 95\\% Student-$t$ interval over the 5 seeds (4 degrees of freedom). Runs with the same seed share the task stream and initial charge, so differences are paired. Top: throughput of each cost model relative to Hungarian in every cell of \\cref{tab:main}. Bottom: the levers of \\cref{subsec:ablation} (throughput relative to the default of the same cost model on the warehouse, 32 robots, batch) and windowed CBS (makespan relative to PP on \\emph{small}).}',
  )
  out.push('\\label{tab:paired}')
  out.push('\\footnotesize')
  out.push('\\begin{tabular}{llrccc}')
  out.push('\\toprule')
  out.push('\\textbf{Layout} & \\textbf{Load} & $|\\mathcal{R}|$ & Greedy & Proxy & \\sname\\\\')
  out.push('\\midrule')
  let nComp = 0
  let nZero = 0
  let worst = 0
  let worstCell = ''
  let worstPoisson = 0
  const excl: string[] = []
  for (const layout of ['warehouse', 'console']) {
    for (const rate of ['0.15', 'inf']) {
      for (const fleet of [8, 16, 32]) {
        const sel = (alloc: string) => main.filter((r) => r.layout === layout && rateKey(r) === rate && r.fleetSize === fleet && r.alloc === alloc)
        const base = sel('hungarian')
        const cells = ['greedy', 'pact-proxy', 'pact'].map((m) => paired(sel(m), base, 'throughput'))
        for (const c of cells) {
          nComp += 1
          if (c.mean - c.half <= 0 && c.mean + c.half >= 0) nZero += 1
          else excl.push(`${layout}/${rate}/${fleet}: ${c.mean.toFixed(2)} +- ${c.half.toFixed(2)}`)
          const bound = Math.max(Math.abs(c.mean - c.half), Math.abs(c.mean + c.half))
          if (rate !== 'inf') worstPoisson = Math.max(worstPoisson, bound)
          if (bound > worst) {
            worst = bound
            worstCell = `${layout}/${rate}/${fleet}`
          }
        }
        out.push(`${layout} & ${rate === 'inf' ? 'batch' : `$\\lambda{=}${rate}$`} & ${fleet} & ${cells.map(fmtCi).join(' & ')}\\\\`)
      }
    }
  }
  out.push('\\midrule')
  out.push('\\multicolumn{3}{l}{\\textbf{Lever} (warehouse, 32, batch)} & \\multicolumn{3}{c}{\\textbf{Throughput} vs.\\ default}\\\\')
  const v = (name: string) => abl.filter((r) => r.variant === name)
  const hungMain = main.filter((r) => r.layout === 'warehouse' && rateKey(r) === 'inf' && r.fleetSize === 32 && r.alloc === 'hungarian')
  const levers: Array<[string, Paired]> = [
    ['window $w{=}10$ (\\sname)', paired(v('pact-w10'), v('pact'), 'throughput')],
    ['window $w{=}30$ (\\sname)', paired(v('pact-w30'), v('pact'), 'throughput')],
    ['dock capacity 2 (\\sname)', paired(v('pact-dock2'), v('pact'), 'throughput')],
    ['dock capacity 2 (Hungarian)', paired(v('hungarian-dock2'), hungMain, 'throughput')],
    ['no event epochs (\\sname)', paired(v('pact-noEvent'), v('pact'), 'throughput')],
    ['no event epochs (Hungarian)', paired(v('hungarian-noEvent'), hungMain, 'throughput')],
    ['replan every tick (\\sname)', paired(v('pact-h1'), v('pact'), 'throughput')],
  ]
  for (const [label, p] of levers) out.push(`\\multicolumn{3}{l}{${label}} & \\multicolumn{3}{c}{${fmtCi(p)}}\\\\`)
  out.push('\\multicolumn{3}{l}{\\textbf{Planner} (small, batch)} & \\multicolumn{3}{c}{\\textbf{Makespan} of CBS vs.\\ PP}\\\\')
  for (const fleet of [4, 6, 8]) {
    const sel = (m: string) => plan.filter((r) => r.fleetSize === fleet && r.mapf === m)
    out.push(`\\multicolumn{3}{l}{${fleet} robots} & \\multicolumn{3}{c}{${fmtCi(paired(sel('cbs'), sel('pp'), 'makespan'))}}\\\\`)
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  const summary = [
    `cost-model comparisons: ${nComp}, intervals containing 0: ${nZero}; excluding 0: ${excl.join('; ')}`,
    `largest |interval bound| over cost models: ${worst.toFixed(2)}% (${worstCell}); under Poisson load: ${worstPoisson.toFixed(2)}%`,
    ...levers.map(([l, p]) => `${l}: ${p.mean.toFixed(2)} +- ${p.half.toFixed(2)}`),
  ].join('\n')
  return { tex: out.join('\n') + '\n', summary }
}

// ---------------------------------------------------------------- review-round sweeps

const sumBy = (rs: Run[], k: string) => rs.reduce((a, r) => a + Number(r[k]), 0)
const maxBy = (rs: Run[], k: string) => rs.reduce((a, r) => Math.max(a, Number(r[k])), Number.NEGATIVE_INFINITY)
const minBy = (rs: Run[], k: string) => rs.reduce((a, r) => Math.min(a, Number(r[k])), Number.POSITIVE_INFINITY)
const meanBy = (rs: Run[], k: string) => sumBy(rs, k) / rs.length
const sdBy = (rs: Run[], k: string) => {
  const m = meanBy(rs, k)
  return Math.sqrt(rs.reduce((a, r) => a + (Number(r[k]) - m) ** 2, 0) / Math.max(1, rs.length - 1))
}
const msRuns = (rs: Run[], k: string, f: (x: number) => string = f1) => `${f(meanBy(rs, k))}\\stdv{${f(sdBy(rs, k))}}`
const intComma = (x: number) => Math.round(x).toLocaleString('en-US').replace(/,/g, '{,}')
const violations = (r: Run) => Number(r.audit_vertexConflicts) + Number(r.audit_swapConflicts) + Number(r.audit_illegalMoves)

function stressTable(): { tex: string; summary: string } {
  const runs = readRuns('stress.json')
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Safety and progress stress sweep.} 60 seeds per configuration, 100 tasks per run; every row aggregates both load regimes (Poisson and batch) and both battery regimes (normal; initial charge $\\mathcal{U}[0.2,0.4]$ with doubled drain), with the allocation method rotating over the four cost models with the seed. Conflicts and illegal moves are counted by the independent trajectory auditor on the executed cells; \\emph{stalled} runs tripped the 1000-tick no-progress detector. $W$: largest trip delay (ticks beyond the free-space distance covered); $Q$: longest wait of a robot below $\\theta_{\\mathrm{lo}}$ for a charger slot; both are maxima over all runs of the row.}',
  )
  out.push('\\label{tab:stress}')
  out.push('\\scriptsize')
  out.push('\\setlength{\\tabcolsep}{3.5pt}')
  out.push('\\begin{tabular}{lrlrrccccrrrc}')
  out.push('\\toprule')
  out.push(
    '\\textbf{Layout} & $|\\mathcal{R}|$ & \\textbf{Planner} & \\textbf{Runs} & \\textbf{Robot-steps} & \\textbf{Vertex} & \\textbf{Swap} & \\textbf{Illegal} & \\textbf{Stalled} & \\textbf{Unfinished} & \\textbf{Depletions} & $W$ / $Q$ & \\textbf{Min SoC}\\\\',
  )
  out.push('\\midrule')
  const layouts: Array<[string, number[]]> = [
    ['small', [4, 6, 8]],
    ['warehouse', [16, 32]],
    ['console', [16, 24]],
    ['narrow', [8, 16]],
  ]
  for (const [layout, fleets] of layouts) {
    for (const fleet of fleets) {
      for (const mapf of ['pp', 'cbs']) {
        const rs = runs.filter((r) => r.layout === layout && r.fleetSize === fleet && r.mapf === mapf)
        if (rs.length !== 240) throw new Error(`stress ${layout}/${fleet}/${mapf}: ${rs.length} runs`)
        out.push(
          `${mapf === 'pp' && fleet === fleets[0] ? layout : ''} & ${mapf === 'pp' ? fleet : ''} & ${mapf.toUpperCase()} & ${rs.length} & ${intComma(sumBy(rs, 'audit_robotTicks'))} & ${sumBy(rs, 'audit_vertexConflicts')} & ${sumBy(rs, 'audit_swapConflicts')} & ${sumBy(rs, 'audit_illegalMoves')} & ${sumBy(rs, 'deadlocked')} & ${sumBy(rs, 'tasksUnfinished')} & ${sumBy(rs, 'depletionEvents')} & ${maxBy(rs, 'audit_maxTripDelay')} / ${maxBy(rs, 'audit_maxSlotWait')} & ${f2(minBy(rs, 'audit_minSoc'))}\\\\`,
        )
      }
    }
    if (layout !== 'narrow') out.push('\\midrule')
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  const byCbs = runs.filter((r) => r.mapf === 'cbs')
  const cbsBig = byCbs.filter((r) => r.layout !== 'small')
  const summary = [
    `stress: runs ${runs.length}, robot-steps ${sumBy(runs, 'audit_robotTicks')}, moves ${sumBy(runs, 'moveActions')}, delivered ${sumBy(runs, 'tasksCompleted')}`,
    `stress: audit vertex ${sumBy(runs, 'audit_vertexConflicts')}, swap ${sumBy(runs, 'audit_swapConflicts')}, illegal ${sumBy(runs, 'audit_illegalMoves')}, sim conflicts ${sumBy(runs, 'conflicts')}, stalled ${sumBy(runs, 'deadlocked')}, unfinished ${sumBy(runs, 'tasksUnfinished')}, depletions ${sumBy(runs, 'depletionEvents')} (audit ${sumBy(runs, 'audit_depletions')})`,
    `stress: max no-progress ${maxBy(runs, 'audit_maxNoProgress')}, max wait streak ${maxBy(runs, 'audit_maxWaitStreak')}, max trip delay W ${maxBy(runs, 'audit_maxTripDelay')}, max slot wait Q ${maxBy(runs, 'audit_maxSlotWait')}, min SoC ${minBy(runs, 'audit_minSoc').toFixed(4)}, max makespan ${maxBy(runs, 'makespan')}`,
    `stress: CBS runs ${byCbs.length}, CBS fallbacks per run on warehouse/console/narrow: mean ${meanBy(cbsBig, 'cbsFallbacks').toFixed(2)}, max ${maxBy(cbsBig, 'cbsFallbacks')}; runs with any fallback ${cbsBig.filter((r) => Number(r.cbsFallbacks) > 0).length}/${cbsBig.length}`,
    ...['small', 'warehouse', 'console', 'narrow'].map(
      (l) => `stress ${l}: W ${maxBy(runs.filter((r) => r.layout === l), 'audit_maxTripDelay')}, Q ${maxBy(runs.filter((r) => r.layout === l), 'audit_maxSlotWait')}, minSoc ${minBy(runs.filter((r) => r.layout === l), 'audit_minSoc').toFixed(4)}`,
    ),
    ...['normal', 'stress'].map((b) => {
      const x = runs.filter((r) => String(r.variant).endsWith(b))
      return `stress battery=${b}: runs ${x.length}, robot-steps ${sumBy(x, 'audit_robotTicks')}, runs with depletion ${x.filter((r) => Number(r.depletionEvents) > 0).length}, depletions ${sumBy(x, 'depletionEvents')}, stalled ${sumBy(x, 'deadlocked')} (with depletion ${x.filter((r) => Number(r.deadlocked) > 0 && Number(r.depletionEvents) > 0).length}), unfinished ${sumBy(x, 'tasksUnfinished')}, max no-progress ${maxBy(x, 'audit_maxNoProgress')}, max wait streak ${maxBy(x, 'audit_maxWaitStreak')}, W ${maxBy(x, 'audit_maxTripDelay')}, Q ${maxBy(x, 'audit_maxSlotWait')}, min SoC ${minBy(x, 'audit_minSoc').toFixed(4)}, charge sessions ${sumBy(x, 'chargeSessions')}`
    }),
    ...['small', 'warehouse', 'console', 'narrow'].map((l) => {
      const x = runs.filter((r) => String(r.variant).endsWith('stress') && r.layout === l)
      return `stress battery=stress ${l}: runs with depletion ${x.filter((r) => Number(r.depletionEvents) > 0).length}/${x.length}, stalled ${sumBy(x, 'deadlocked')}`
    }),
    (() => {
      const orig = ['main', 'planner', 'scaling', 'ablation', 'battery'].flatMap((n) => readRuns(`${n}.json`))
      const both = [...orig, ...runs]
      return `first round + stress: runs ${both.length}, robot-steps ${sumBy(both, 'audit_robotTicks')}, audit vertex+swap+illegal ${both.reduce((a, r) => a + violations(r), 0)}\n` + `original sweeps (seeds 1-5): runs ${orig.length}, robot-steps ${sumBy(orig, 'audit_robotTicks')}, audit vertex ${sumBy(orig, 'audit_vertexConflicts')}, swap ${sumBy(orig, 'audit_swapConflicts')}, illegal ${sumBy(orig, 'audit_illegalMoves')}, depletions ${sumBy(orig, 'audit_depletions')}, sim conflicts ${sumBy(orig, 'conflicts')}, stalled ${sumBy(orig, 'deadlocked')}, unfinished ${sumBy(orig, 'tasksUnfinished')}, moves ${sumBy(orig, 'moveActions')}, waits ${sumBy(orig, 'waitActions')}, delivered ${sumBy(orig, 'tasksCompleted')}`
    })(),
  ].join('\n')
  return { tex: out.join('\n') + '\n', summary }
}

/** Largest free-space distance from any free cell to any charger slot. */
function farthestSlot(layout: string): number {
  const map = loadLayout(layout)
  const oracle = new DistanceOracle(map)
  let best = 0
  for (const s of chargerSlots(map)) {
    const d = oracle.toGoal(s)
    for (let c = 0; c < d.length; c += 1) if (d[c] > best) best = d[c]
  }
  return best
}

/**
 * Proposition 3 check: the reserve and threshold that would make the measured
 * delays (W, Q of the normal-battery stress runs) provably safe, against the
 * defaults. Also the paired CBS-vs-PP makespan from the stress sweep.
 */
function reserveTable(): { tex: string; summary: string } {
  const runs = readRuns('stress.json').filter((r) => String(r.variant).endsWith('normal'))
  const bm = DEFAULT_BATTERY.drainMove
  const bw = DEFAULT_BATTERY.drainWait
  const delta = DEFAULT_CONFIG.dwell
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  const capAt = out.length
  const factors: number[] = []
  const zeroOk: string[] = []
  out.push('\\label{tab:reserve}')
  out.push('\\footnotesize')
  out.push('\\begin{tabular}{lrrrcccc}')
  out.push('\\toprule')
  out.push('\\textbf{Layout} & $D_\\sigma$ & $W$ & $Q$ & \\textbf{Req.\\ $\\rho$} & \\textbf{Req.\\ $\\rho$ ($W{=}Q{=}0$)} & \\textbf{Req.\\ $\\theta_{\\mathrm{lo}}$} & \\textbf{Min SoC seen}\\\\')
  out.push('\\midrule')
  const lines: string[] = []
  for (const layout of ['small', 'warehouse', 'console', 'narrow']) {
    const rs = runs.filter((r) => r.layout === layout)
    const D = farthestSlot(layout)
    const W = maxBy(rs, 'audit_maxTripDelay')
    const Q = maxBy(rs, 'audit_maxSlotWait')
    const rho = bm * (3 * W + Q + D) + 2 * bw * delta
    const rho0 = bm * D + 2 * bw * delta
    const theta = bm * (1 + Q + W + D)
    out.push(`${layout} & ${D} & ${W} & ${Q} & ${f2(rho)} & ${f2(rho0)} & ${f2(theta)} & ${f2(minBy(rs, 'audit_minSoc'))}\\\\`)
    factors.push(rho / DEFAULT_BATTERY.reserve)
    if (rho0 < DEFAULT_BATTERY.reserve) zeroOk.push(`\\emph{${layout}}`)
    lines.push(`reserve ${layout}: D_sigma ${D}, W ${W}, Q ${Q}, required rho ${rho.toFixed(4)} (W=Q=0: ${rho0.toFixed(4)}), required theta_lo ${theta.toFixed(4)}, min SoC ${minBy(rs, 'audit_minSoc').toFixed(4)}`)
  }
  out.splice(
    capAt,
    0,
    `\\caption{\\textbf{What \\cref{prop:charge} would need.} $D_\\sigma$: largest free-space distance from any cell to any charger slot. $W$, $Q$: largest trip delay and slot wait measured by the auditor over the normal-battery runs of \\cref{tab:stress} (all fleet sizes, planners and loads of the layout). Required: the right-hand sides of \\cref{eq:reserve} with these $W$, $Q$ and the default drain ($\\beta_{\\mathrm{m}}{=}${bm}$, $\\beta_{\\mathrm{w}}{=}${bw}$, $\\delta{=}${delta}$); the defaults are $\\rho{=}${DEFAULT_BATTERY.reserve}$, $\\theta_{\\mathrm{lo}}{=}${DEFAULT_BATTERY.socLow}$. With $W{=}Q{=}0$ the default reserve would suffice only on ${zeroOk.length ? zeroOk.join(', ') : 'no layout'}; with the measured $W$ and $Q$ it is short by a factor of ${Math.floor(Math.min(...factors))} to ${Math.ceil(Math.max(...factors))} on every layout.}`,
  )
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  // CBS vs PP on the stress sweep: same seed => same allocation method, task
  // stream and initial charge; pooled over both loads (120 pairs per row).
  const all = readRuns('stress.json').filter((r) => String(r.variant).endsWith('normal'))
  for (const [layout, fleets] of [
    ['small', [4, 6, 8]],
    ['warehouse', [16, 32]],
    ['console', [16, 24]],
    ['narrow', [8, 16]],
  ] as Array<[string, number[]]>) {
    for (const fleet of fleets) {
      const pick = (m: string) => all.filter((r) => r.layout === layout && r.fleetSize === fleet && r.mapf === m)
      const key = (r: Run) => `${r.seed}|${r.arrivalRate}`
      const pp = pick('pp')
      const cbsRuns = pick('cbs')
      const ppByKey = new Map(pp.map((r) => [key(r), r]))
      const rel = cbsRuns.map((r) => {
        const o = ppByKey.get(key(r)) as Run
        return (100 * (Number(r.makespan) - Number(o.makespan))) / Number(o.makespan)
      })
      const n = rel.length
      const m = rel.reduce((a, b) => a + b, 0) / n
      const sd = Math.sqrt(rel.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1))
      const half = (T975[n] * sd) / Math.sqrt(n)
      lines.push(
        `stress cbs vs pp makespan ${layout}/${fleet}: ${m.toFixed(2)} +- ${half.toFixed(2)} (n=${n}); cbs fallbacks/run ${meanBy(cbsRuns, 'cbsFallbacks').toFixed(2)}, epochs/run ${meanBy(cbsRuns, 'epochs').toFixed(1)}, cbs ms/tick ${meanBy(cbsRuns, 'plannerMsPerTick').toFixed(2)} vs pp ${meanBy(pp, 'plannerMsPerTick').toFixed(2)} (10 parallel workers)`,
      )
    }
  }
  return { tex: out.join('\n') + '\n', summary: lines.join('\n') }
}

function cascadeTable(): { tex: string; summary: string } {
  const runs = readRuns('cascade.json')
  const settings: Array<[string, string]> = [
    ['warehouse-32', 'warehouse, 32'],
    ['warehouse-32-dock4', 'warehouse, 32, $\\kappa_{\\mathrm{d}}{=}4$'],
    ['small-8', 'small, 8'],
    ['narrow-16', 'narrow, 16'],
  ]
  const variants: Array<[string, string]> = [
    ['cascade', 'hold cascade (default)'],
    ['none', 'hold, no repair'],
    ['restart', 'priority restarts'],
    ['static', 'cascade, static priorities'],
  ]
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Hold-cascade and priority ablation} (batch load, Hungarian allocation, PP, 30 seeds; 200 tasks, 100 on \\emph{small}). \\emph{No repair}: a robot without a path holds its cell but robots whose reservations cross it keep their paths. \\emph{Priority restarts}: the failing robot is moved to the front and the group is re-planned, up to 3 times, then as \\emph{no repair}. \\emph{Static priorities}: status rank and id only, no held-first or blocking-first ordering. Conflicts are counted by the independent auditor; runs are not stopped at a conflict.}',
  )
  out.push('\\label{tab:cascade}')
  out.push('\\scriptsize')
  out.push('\\setlength{\\tabcolsep}{4pt}')
  out.push('\\begin{tabular}{llccccc}')
  out.push('\\toprule')
  out.push('\\textbf{Setting} & \\textbf{Fallback} & \\textbf{Runs w/ conflict} & \\textbf{Conflicts} & \\textbf{Stalled runs} & \\textbf{Throughput} & \\textbf{Holds / run}\\\\')
  out.push('\\midrule')
  const lines: string[] = []
  for (const [setting, label] of settings) {
    variants.forEach(([v, vl], i) => {
      const rs = runs.filter((r) => r.variant === `${setting}/${v}`)
      if (rs.length !== 30) throw new Error(`cascade ${setting}/${v}: ${rs.length}`)
      const withConf = rs.filter((r) => violations(r) > 0).length
      out.push(
        `${i === 0 ? label : ''} & ${vl} & ${withConf}/30 & ${sumBy(rs, 'audit_vertexConflicts') + sumBy(rs, 'audit_swapConflicts')} & ${sumBy(rs, 'deadlocked')}/30 & ${msRuns(rs, 'throughput')} & ${f1(meanBy(rs, 'holdEvents'))}\\\\`,
      )
      lines.push(
        `cascade ${setting}/${v}: runs with conflict ${withConf}/30, conflicts ${sumBy(rs, 'audit_vertexConflicts') + sumBy(rs, 'audit_swapConflicts')} (sim ${sumBy(rs, 'conflicts')}), stalled ${sumBy(rs, 'deadlocked')}, unfinished ${sumBy(rs, 'tasksUnfinished')}, depletions ${sumBy(rs, 'depletionEvents')}, throughput ${meanBy(rs, 'throughput').toFixed(2)}, holds ${meanBy(rs, 'holdEvents').toFixed(1)}`,
      )
    })
    if (setting !== 'narrow-16') out.push('\\midrule')
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  const d4 = paired(
    runs.filter((r) => r.variant === 'warehouse-32-dock4/cascade'),
    runs.filter((r) => r.variant === 'warehouse-32/cascade'),
    'throughput',
  )
  lines.push(`cascade dock 4 vs dock 3 (cascade, paired throughput): ${d4.mean.toFixed(2)} +- ${d4.half.toFixed(2)}`)
  return { tex: out.join('\n') + '\n', summary: lines.join('\n') }
}

function baselinesTable(): { tex: string; summary: string } {
  const runs = readRuns('baselines.json')
  const settings: Array<[string, string]> = [
    ['warehouse-16-batch', 'warehouse, 16, batch'],
    ['warehouse-32-batch', 'warehouse, 32, batch'],
    ['warehouse-16-poisson', 'warehouse, 16, $\\lambda{=}0.15$'],
    ['console-16-batch', 'console, 16, batch'],
    ['narrow-16-batch', 'narrow, 16, batch'],
  ]
  const variants: Array<[string, string]> = [
    ['tp', 'TP'],
    ['tpts', 'TPTS'],
    ['hungarian', 'RH + Hungarian'],
    ['pact', 'RH + \\sname'],
    ['hungarian-dock1', 'RH + Hungarian, $\\kappa_{\\mathrm{d}}{=}1$'],
    ['pact-dock1', 'RH + \\sname, $\\kappa_{\\mathrm{d}}{=}1$'],
  ]
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Token-passing baselines} (200 tasks, 30 seeds). TP and TPTS \\citep{ma2017lifelong} plan each robot\'s whole trip against the complete paths of all others; RH is the rolling-horizon loop of \\cref{alg:pact} ($w{=}20$, $h{=}5$, PP with hold cascade, $\\kappa_{\\mathrm{d}}{=}3$ unless stated). Paired: seed-paired throughput difference to RH + Hungarian with a 95\\% $t$-interval (29 degrees of freedom). No run of any variant had an executed conflict or stalled.}',
  )
  out.push('\\label{tab:baselines}')
  out.push('\\scriptsize')
  out.push('\\setlength{\\tabcolsep}{4pt}')
  out.push('\\begin{tabular}{llcccc}')
  out.push('\\toprule')
  out.push('\\textbf{Setting} & \\textbf{Method} & \\textbf{Throughput} $\\uparrow$ & \\textbf{Paired vs.\\ RH + Hungarian} & \\textbf{Service time} $\\downarrow$ & \\textbf{Task swaps}\\\\')
  out.push('\\midrule')
  const lines: string[] = []
  for (const [setting, label] of settings) {
    const base = runs.filter((r) => r.variant === `${setting}/hungarian`)
    variants.forEach(([v, vl], i) => {
      const rs = runs.filter((r) => r.variant === `${setting}/${v}`)
      if (rs.length !== 30) throw new Error(`baselines ${setting}/${v}: ${rs.length}`)
      const p = v === 'hungarian' ? null : paired(rs, base, 'throughput')
      out.push(
        `${i === 0 ? label : ''} & ${vl} & ${msRuns(rs, 'throughput')} & ${p ? fmtCi(p) : '--'} & ${msRuns(rs, 'meanServiceTime', f0)} & ${v === 'tpts' ? f1(meanBy(rs, 'taskSwaps')) : '--'}\\\\`,
      )
      lines.push(
        `baselines ${setting}/${v}: throughput ${meanBy(rs, 'throughput').toFixed(2)}, service ${meanBy(rs, 'meanServiceTime').toFixed(1)}, paired vs hungarian ${p ? `${p.mean.toFixed(2)} +- ${p.half.toFixed(2)}` : '-'}, violations ${rs.reduce((a, r) => a + violations(r), 0)}, stalled ${sumBy(rs, 'deadlocked')}, unfinished ${sumBy(rs, 'tasksUnfinished')}, depletions ${sumBy(rs, 'depletionEvents')}, swaps ${meanBy(rs, 'taskSwaps').toFixed(1)}, astar ${meanBy(rs, 'astarCalls').toFixed(0)}`,
      )
    })
    const k1 = runs.filter((r) => r.variant === `${setting}/hungarian-dock1`)
    for (const v of ['tp', 'tpts', 'pact-dock1']) {
      const p = paired(
        runs.filter((r) => r.variant === `${setting}/${v}`),
        k1,
        'throughput',
      )
      lines.push(`baselines ${setting} ${v} vs hungarian-dock1 (paired throughput): ${p.mean.toFixed(2)} +- ${p.half.toFixed(2)}`)
    }
    if (setting !== 'narrow-16-batch') out.push('\\midrule')
  }
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  return { tex: out.join('\n') + '\n', summary: lines.join('\n') }
}

function couplingTable(): { tex: string; summary: string } {
  const runs = readRuns('coupling.json')
  const regimes: Array<[string, string]> = [
    ['narrow-aisles', 'One-lane aisles'],
    ['hotspot', 'Hotspot demand'],
    ['long-trips', 'Long empty trips'],
    ['saturated-chargers', 'Saturated chargers'],
  ]
  const out: string[] = []
  out.push('\\begin{table}[t]')
  out.push('\\centering')
  out.push(
    '\\caption{\\textbf{Coupling regimes}, chosen before running them as the settings where path-aware costs could plausibly matter (200 tasks, 30 seeds). \\emph{One-lane aisles}: narrow layout, 16 robots, batch. \\emph{Hotspot} (warehouse, 32, batch): 80\\% of pickups at the 10\\% of pickup points nearest the floor centre. \\emph{Long empty trips} (warehouse, 24, $\\lambda{=}0.1$): pickups only at the 25\\% of pickup points farthest from any dock. \\emph{Saturated chargers} (warehouse, batch): 32 robots on 8 slots, initial charge $\\mathcal{U}[0.2,0.4]$, triple drain. Throughput in tasks per 100 ticks and service time in ticks, mean\\stdv{std}; paired: seed-paired relative differences in \\% with 95\\% $t$-intervals (29 degrees of freedom), negative service-time differences are improvements; stalled: runs (of 30) that tripped the stall detector.}',
  )
  out.push('\\label{tab:coupling}')
  out.push('\\scriptsize')
  out.push('\\setlength{\\tabcolsep}{4pt}')
  out.push('\\begin{tabular}{llccccccc}')
  out.push('\\toprule')
  out.push(
    ' & & \\multicolumn{2}{c}{\\textbf{Mean}\\stdv{std}} & \\multicolumn{2}{c}{\\textbf{Paired vs.\\ Hungarian} (\\%)} & \\multicolumn{2}{c}{\\textbf{Paired vs.\\ Greedy} (\\%)} & \\\\',
  )
  out.push('\\cmidrule(lr){3-4}\\cmidrule(lr){5-6}\\cmidrule(lr){7-8}')
  out.push('\\textbf{Regime} & \\textbf{Method} & \\textbf{Thr.} $\\uparrow$ & \\textbf{Service} $\\downarrow$ & \\textbf{Thr.} & \\textbf{Service} & \\textbf{Thr.} & \\textbf{Service} & \\textbf{Stalled}\\\\')
  out.push('\\midrule')
  const sel = (reg: string, m: string) => runs.filter((r) => r.variant === `${reg}/${m}`)
  const lines: string[] = []
  let nComp = 0
  let nExcl = 0
  const note = (reg: string, a: string, b: string, k: string, p: Paired) => {
    nComp += 1
    const excl = p.mean - p.half > 0 || p.mean + p.half < 0
    if (excl) nExcl += 1
    lines.push(`coupling ${reg} ${a} vs ${b} ${k}: ${p.mean.toFixed(2)} +- ${p.half.toFixed(2)}${excl ? ' (excludes 0)' : ''}`)
  }
  for (const [reg, label] of regimes) {
    METHODS.forEach((m, i) => {
      const rs = sel(reg, m)
      if (rs.length !== 30) throw new Error(`coupling ${reg}/${m}: ${rs.length}`)
      const vsH = m === 'hungarian' ? null : [paired(rs, sel(reg, 'hungarian'), 'throughput'), paired(rs, sel(reg, 'hungarian'), 'meanServiceTime')]
      const vsG = m === 'greedy' ? null : [paired(rs, sel(reg, 'greedy'), 'throughput'), paired(rs, sel(reg, 'greedy'), 'meanServiceTime')]
      if (vsH) {
        note(reg, m, 'hungarian', 'throughput', vsH[0])
        note(reg, m, 'hungarian', 'service', vsH[1])
      }
      if (vsG && m !== 'hungarian') {
        note(reg, m, 'greedy', 'throughput', vsG[0])
        note(reg, m, 'greedy', 'service', vsG[1])
      }
      if (vsG && m === 'hungarian') lines.push(`coupling ${reg} hungarian vs greedy throughput: ${vsG[0].mean.toFixed(2)} +- ${vsG[0].half.toFixed(2)}; service ${vsG[1].mean.toFixed(2)} +- ${vsG[1].half.toFixed(2)}`)
      out.push(
        `${i === 0 ? label : ''} & ${METHOD_LABEL[m]} & ${msRuns(rs, 'throughput')} & ${msRuns(rs, 'meanServiceTime', f0)} & ${vsH ? `${fmtCi(vsH[0])} & ${fmtCi(vsH[1])}` : '-- & --'} & ${vsG ? `${fmtCi(vsG[0])} & ${fmtCi(vsG[1])}` : '-- & --'} & ${sumBy(rs, 'deadlocked')}\\\\`,
      )
      lines.push(
        `coupling ${reg}/${m}: throughput ${meanBy(rs, 'throughput').toFixed(2)}, service ${meanBy(rs, 'meanServiceTime').toFixed(1)}, violations ${rs.reduce((a, r) => a + violations(r), 0)}, stalled ${sumBy(rs, 'deadlocked')}, unfinished ${sumBy(rs, 'tasksUnfinished')}, depletions ${sumBy(rs, 'depletionEvents')}, waits ${meanBy(rs, 'waitActions').toFixed(1)}, charge ${meanBy(rs, 'chargeSessions').toFixed(1)}, queue ${meanBy(rs, 'meanWaitTime').toFixed(1)}, exec ${meanBy(rs, 'meanExecTime').toFixed(1)}`,
      )
    })
    if (reg !== 'saturated-chargers') out.push('\\midrule')
  }
  lines.push(`coupling: ${nComp} paired comparisons, ${nExcl} exclude 0`)
  out.push('\\bottomrule')
  out.push('\\end{tabular}')
  out.push('\\end{table}')
  return { tex: out.join('\n') + '\n', summary: lines.join('\n') }
}

function main() {
  mkdirSync(join(PAPER, 'tables'), { recursive: true })
  mkdirSync(join(PAPER, 'figures/data'), { recursive: true })
  const mainRows = readCsv('main_summary.csv')
  const plannerRows = readCsv('planner_summary.csv')
  const scalingRows = readCsv('scaling_summary.csv')
  const ablationRows = readCsv('ablation_summary.csv')
  const batteryRows = readCsv('battery_summary.csv')
  writeFileSync(join(PAPER, 'tables/main.tex'), mainTable(mainRows))
  writeFileSync(join(PAPER, 'tables/planner.tex'), plannerTable(plannerRows))
  writeFileSync(join(PAPER, 'tables/ablation.tex'), ablationTable(ablationRows))
  writeFileSync(join(PAPER, 'tables/battery.tex'), batteryTable(batteryRows))
  writeFileSync(join(PAPER, 'tables/scaling.tex'), scalingTable(scalingRows))
  const pairedOut = pairedTable()
  writeFileSync(join(PAPER, 'tables/paired.tex'), pairedOut.tex)
  console.log(pairedOut.summary)
  for (const [name, fn] of [
    ['stress', stressTable],
    ['reserve', reserveTable],
    ['cascade', cascadeTable],
    ['baselines', baselinesTable],
    ['coupling', couplingTable],
  ] as Array<[string, () => { tex: string; summary: string }]>) {
    const r = fn()
    writeFileSync(join(PAPER, `tables/${name}.tex`), r.tex)
    console.log(r.summary)
  }
  const cols = ['throughput', 'meanServiceTime', 'plannerMsPerTick', 'waitActions', 'astarCalls', 'utilization', 'makespan']
  writeFileSync(join(PAPER, 'figures/data/scaling_hungarian.csv'), seriesCsv(scalingRows, (r) => r.variant === 'hungarian', 'fleetSize', cols))
  writeFileSync(join(PAPER, 'figures/data/scaling_pact.csv'), seriesCsv(scalingRows, (r) => r.variant === 'pact', 'fleetSize', cols))
  writeFileSync(join(PAPER, 'figures/data/planner_pp.csv'), seriesCsv(plannerRows, (r) => r.variant === 'pp', 'fleetSize', ['makespan', 'meanServiceTime', 'waitActions', 'plannerMsPerTick']))
  writeFileSync(join(PAPER, 'figures/data/planner_cbs.csv'), seriesCsv(plannerRows, (r) => r.variant === 'cbs', 'fleetSize', ['makespan', 'meanServiceTime', 'waitActions', 'plannerMsPerTick']))
  // Window ablation as a small series (w = 10, 20, 30).
  const win = ablationRows
    .filter((r) => ['pact-w10', 'pact', 'pact-w30'].includes(r.variant))
    .map((r) => ({ ...r, window: r.variant === 'pact-w10' ? '10' : r.variant === 'pact-w30' ? '30' : '20' }))
  writeFileSync(join(PAPER, 'figures/data/window.csv'), seriesCsv(win, () => true, 'window', ['throughput', 'meanServiceTime', 'plannerMsPerTick', 'waitActions']))
  console.log('paper tables and figure data written')
}

main()
