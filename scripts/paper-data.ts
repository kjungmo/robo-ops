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
    '\\caption{\\textbf{Allocation methods across layouts, fleet sizes and load regimes.} Throughput (delivered tasks per 100 ticks) and mean service time (ticks from arrival to delivery), mean\\stdv{std} over 5 seeds, 200 tasks per run, prioritized planning with $w{=}20$, $h{=}5$. Load $\\lambda{=}0.15$ is a Poisson stream of 0.15 tasks/tick; \\emph{batch} releases all 200 tasks at $t{=}0$. Best mean per row in bold; no method leaves the one-standard-deviation band of the others in any row.}',
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
  out.push('\\small')
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
  out.push('\\small')
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
