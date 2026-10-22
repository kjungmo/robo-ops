# NUMBERS.md — provenance of every number in the paper

All results live in `paper/experiments/results/` (committed). `<sweep>_summary.csv`
holds mean/std/max over seeds per configuration (row selected by `layout`, `fleetSize`,
`arrivalRate`, `variant`, `mapf`, `alloc`); `<sweep>.json` holds one record per run,
including the independent auditor's `audit_*` fields.
`scripts/paper-data.ts` regenerates `tables/*.tex` and `figures/data/*.csv` from these
files and prints summary lines (quoted below as "script: ...") for every number that
appears in the text but not in a table. Notation: `file : row-selector : field`.

This file is documentation. The check is `npm run check:paper` (`scripts/check-paper.ts`):
it regenerates every table and figure data file and compares them byte for byte, recomputes
every `<sweep>_summary.csv` from `<sweep>.json`, recomputes every number quoted in the text
(one claim per number, built from the results and from the constants in `src/fms`), and fails
if any digit in the abstract, the sections, the appendix or a figure caption is not covered
by a claim. CI runs it on pull requests and on pushes to `main`. `npm run check:results -- <dir>` compares a re-run of
the benchmark (`npm run bench:fms -- <sweeps> --out <dir>`) with the committed records.

All ten sweeps (7,200 runs) were written by one run of `scripts/regenerate.sh 8` at commit
`63a2db7` (`bench-meta.json : commit, workers, runs, runsPerSweep`). Before it replaced the earlier
records, the script compared the 6,600 runs that already existed (written at `27080ab` and `2d4342a`,
on 1 and 10 workers) with the new ones: 0 differing fields outside the four wall-clock fields
(`paper/experiments/repro/regeneration.json`). The `tpfree` sweep (600 runs) is new.

Wall-clock numbers have their own source. Every planner time in the paper comes from
`paper/experiments/timing/summary.json` (`scripts/measure-timing.sh`: three single-process repeats of
the planner, scaling and ablation sweeps, each admitted at a 1-minute load average of at most 0.50;
`host-<n>.txt` records load, cores and top CPU consumers before and after; `repeat-<n>.csv` the
per-run times). The wall-clock fields inside `results/*.json` were written under 8 workers and are
not quoted anywhere.

"First round" means the main, planner, scaling, ablation and battery sweeps (seeds 1–5, 420 runs);
"second round" the others (6,780 runs). The stress, cascade, baselines and coupling sweeps were
defined in `4a72ff1` (2026-09-28 17:06:16 +0900), which precedes the first commit of their results,
`dccf403` (17:42:40), by 36 minutes; git shows commit order only, which is what §4.1 claims. The
`tpfree` sweep was added later, when the baseline results were known (stated in §4.1).

## Bench-wide totals (abstract, §1, §4.2 "Correctness", §6)

| Claim | Source |
|---|---|
| 420 first-round runs; 0 conflicts (simulator and auditor); 0 stalls; 0 depletions | sums of `conflicts`, `audit_vertexConflicts`, `audit_swapConflicts`, `audit_illegalMoves`, `deadlocked`, `depletionEvents` over the five first-round `*.json` |
| 6,600 earlier runs: no field differed when the records were regenerated (§4.1, appendix A) | `paper/experiments/repro/regeneration.json : records 6600, differingFields 0, sweepsWithoutCommittedFile ["tpfree"]` |
| three timing repeats, all valid, admitted at load ≤ 0.5; largest spread 4 % (§4.1) | `timing/summary.json : validRepeats [1,2,3], invalidRepeats [], load[].before 0.43 / 0.47 / 0.50, loadMax 0.5`; max over configurations of max(perRepeat) / min(perRepeat) = 1.040 |
| 46 `SimMetrics` fields (10 configuration, 36 measured), 13 auditor fields (appendix C) | keys of any record: 62 = 46 + 13 `audit_*` + `sweep`, `variant`, `wallMs`; the same in all ten sweeps |
| every run delivers all of its tasks | sum of `tasksUnfinished` over all 420 records = 0 (longest run: `makespan` 4189, scaling sweep) |
| 8,833,050 robot-steps | script: `original sweeps (seeds 1-5): runs 420, robot-steps 8833050` (sum of `audit_robotTicks` = `makespan * fleetSize`) |
| 5,317,603 move actions | sum of `moveActions` over the same records |
| 81,000 delivered tasks | sum of `tasksCompleted` over the same records (390 runs × 200 + 30 runs × 100) |
| commit of the benchmarked code `63a2db7`, 8 worker processes, 7,200 runs | `bench-meta.json : commit, workers, runs` |
| CPU "AMD Ryzen 5 5500GT", Node 22 | `bench-meta.json : cpu, node`; `timing/summary.json : cpu, node` |
| seeds 1–5 / 1–60 / 1–30 | meta files `: seeds` |
| 6,780 second-round runs (§1) | `bench-meta.json : runsPerSweep` stress 4320 + cascade 480 + baselines 900 + coupling 480 + tpfree 600 |
| 4,740 runs, 60.4 million robot-steps, no executed conflict (abstract, §1, §6) | script: `first round + stress: runs 4740, robot-steps 60384750, audit vertex+swap+illegal 0` |

## §4.2 Main results, Table 1 (`tables/main.tex`)

Every cell: `main_summary.csv : layout, fleetSize, arrivalRate ∈ {0.15, inf}, variant ∈ {greedy, hungarian, pact-proxy, pact} : throughput_mean/std, meanServiceTime_mean/std`.

| Claim | Source |
|---|---|
| ≤ 2.9 % throughput spread in every cell; worst cell warehouse/32/batch: 29.7 greedy, 30.6 Hungarian, 30.6 Proxy, 30.3 PACT | `main_summary.csv : warehouse, 32, inf : throughput_mean` = 29.7237 / 30.5503 / 30.5988 / 30.2912 → (30.5988−29.7237)/30.5988 = 2.86 % ≤ 2.9 % |
| throughput means differ by less than the smallest of the four standard deviations in every cell; service-time means by less than the largest | `main_summary.csv : throughput_mean/std, meanServiceTime_mean/std` per cell (service time: the range exceeds the smallest std only in warehouse/16/0.15, 3.7 vs 2.7, largest 7.7) |
| 233–297 wait actions per run (warehouse, 32, batch) | `main_summary.csv : warehouse, 32, inf, hungarian/greedy : waitActions_mean` = 233.4 (min) / 296.8 (max) |
| service 283–287, queueing 216–220, "the remaining 66 ticks or so" (warehouse, 32, batch; §5) | `main_summary.csv : warehouse, 32, inf, * : meanServiceTime_mean` = 282.5–287.4 (283–287 as rounded in Table 1); `meanWaitTime_mean` = 216.3–220.1; `meanExecTime_mean` = 66.2–67.3 |
| holds ≤ 5.2 per run in the main sweep | max of `main_summary.csv : holdEvents_mean` = 5.2 (console, 32, inf, hungarian) |
| "about 1.4 waits per task": 274 waits vs 14.9 thousand moves (273.8 / 200 = 1.37) | `main_summary.csv : warehouse, 32, inf, pact : waitActions_mean` = 273.8; `moveActions_mean` = 14937.2 |

## §4.2 Planner backend, Table 3 (`tables/planner.tex`), Fig. 2 left/centre (`figures/data/planner_pp.csv`, `planner_cbs.csv`)

| Claim | Source |
|---|---|
| makespan −2.8 % / −8.3 % / −8.3 % at 4 / 6 / 8 robots | `planner_summary.csv : fleetSize, variant=pp/cbs : makespan_mean` = 789.0→766.6, 561.6→515.0, 513.4→470.8 |
| wait actions −19 / −24 / −31 % | `waitActions_mean` = 59.6→48.2, 134.6→102.4, 213.6→148.0 |
| service time −6–10 % | `meanServiceTime_mean` = 318.1→300.3 (−5.6 %), 262.0→238.8 (−8.9 %), 242.1→218.0 (−9.9 %) |
| 0.09–0.30 planner ms/tick (CBS; §4.2 and §5) | `timing/summary.json : planner, cbs : median` = 0.0909, 0.2995, 0.2977 |
| seed-paired CBS makespan −2.8±2.1 / −8.2±3.6 / −8.2±4.3 % | `tables/paired.tex` (bottom block), computed by `scripts/paper-data.ts : pairedTable` from `planner.json` |
| 0.6 fallbacks per run at 6 robots, 0 elsewhere | `cbsFallbacks_mean` = 0, 0.6, 0 |

## §4.2 Scaling, Fig. 3 (`figures/data/scaling_*.csv`), Table 12 (`tables/scaling.tex`)

| Claim | Source |
|---|---|
| throughput 4.9 → 33.7 tasks/100 ticks | `scaling_summary.csv : fleetSize=4, hungarian : throughput_mean` = 4.9019; `fleetSize=48, pact` = 33.654 |
| flattens beyond 40 robots; utilisation 0.41 at 48 | `throughput_mean` 33.02 (40, hungarian) vs 33.25 (48); `utilization_mean` = 0.4056 (48, hungarian) |
| service time 1909 → 252 ticks | `meanServiceTime_mean` = 1909.468 (4, hungarian) / 252.225 (48, hungarian) |
| planner 0.02 → 0.76 ms/tick Hungarian, 0.98 PACT; "0.02–0.98 ms" in §5 | `timing/summary.json : scaling : median` = 0.0195 (4, hungarian), 0.7624 (48, hungarian), 0.9827 (48, pact) |
| +35 % A* calls at 48 robots: 16,229 vs 12,021 | `astarCalls_mean` = 16229.4 (48, pact) / 12021.4 (48, hungarian) |
| dock bound "9 docks × κ_d = 3" | layout constant (warehouse docks = 9, `WAREHOUSE_SPEC`) × `DEFAULT_CONFIG.dockCapacity` |

## §4.3 Ablations, Table 4 (`tables/ablation.tex`), Fig. 2 right (`figures/data/window.csv`)

All rows: `ablation_summary.csv : variant : throughput_mean, meanServiceTime_mean, waitActions_mean, holdEvents_mean, plannerMsPerTick_mean, utilization_mean`.

| Claim | Source |
|---|---|
| dock capacity 2: 24.0 (PACT) / 23.7 (Hungarian) vs 30.3 / 30.6 → +26 / +29 % for capacity 3 | `pact-dock2 : throughput_mean` = 23.9853, `hungarian-dock2` = 23.6748; defaults `main_summary.csv : warehouse, 32, inf, pact/hungarian` = 30.2912 / 30.5503 |
| utilisation 0.64 → 0.42 | `pact : utilization_mean` = 0.6362; `pact-dock2` = 0.4175 |
| w=10: 32.4 (+7 %), waits 150 vs 274, 0.19 vs 0.62 ms/tick | `pact-w10 : throughput_mean` = 32.3675, `waitActions_mean` = 149.8; `pact` = 30.2912 / 273.8; `timing/summary.json : ablation : median` = 0.1903 (`pact-w10`), 0.6204 (`pact`) |
| w=30: 28.2 (−7 %), 2.00 ms/tick | `pact-w30 : throughput_mean` = 28.2265; `timing/summary.json : ablation, pact-w30 : median` = 1.9965 |
| h=1: 30.3 at 2.2× the A* expansions per tick | `pact-h1 : throughput_mean` = 30.254; `expansions_mean / makespan_mean` of `pact-h1` over `pact` = 2.22 |
| no event epochs: −1–5 % throughput, +55–125 waits | `pact-noEvent` = 29.9066 (−1.3 %), waits 329.2 (+55.4); `hungarian-noEvent` = 28.925 vs 30.5503 (−5.3 %), waits 358.6 vs 233.4 (+125.2) |
| battery term neutral (< 0.5: +0.01 PACT, −0.43 Hungarian) | `pact-noBattery` 30.3025 vs `pact` 30.2912; `hungarian-noBattery` 30.119 vs `main_summary.csv : warehouse, 32, inf, hungarian` 30.5503 |
| K = 3 / 12 change ≤ 0.13 | `pact-K3` = 30.234, `pact-K12` = 30.4203 vs 30.2912 (differences 0.057 and 0.129) |


## Seed-paired comparisons, Table 11 (`tables/paired.tex`), §1, §4.2, §4.3, §6

Computed by `scripts/paper-data.ts : pairedTable()` from the per-run records (`main.json`, `ablation.json`, `planner.json`): per-seed relative difference `100·(x_variant − x_base)/x_base`, mean and two-sided 95 % Student-t half-width with 4 degrees of freedom (t = 2.776). The script prints the summary lines quoted below.

| Claim | Source |
|---|---|
| 35 of 36 cost-model intervals vs Hungarian contain 0; the exception PACT console/32/batch −2.3±2.0 % | script summary `intervals containing 0: 35; excluding 0: console/inf/32: -2.29 +- 2.02` |
| every interval within ±3.7 % under Poisson load and ±7.1 % under batch load ("about 4 %" / "about 7 %" in §1) | script summary `largest |interval bound| ... 7.06% (console/inf/8); under Poisson load: 3.71%` |
| 1.8 exclusions expected by chance among independent intervals | 36 × 0.05 (the text notes that the 36 intervals share baselines and seeds) |
| window w=10 +6.9±1.6 %, w=30 −6.9±3.9 % | script summary lines `window $w{=}10$` / `$w{=}30$` |
| dock capacity 2 costs 20.7±3.3 % (PACT) / 22.5±2.2 % (Hungarian) | script summary lines `dock capacity 2` |
| no event epochs: Hungarian −5.2±3.3 %, PACT −1.2±5.2 % | script summary lines `no event epochs` |

## §4.2 Battery stress, Table 13 (`tables/battery.tex`)

| Claim | Source |
|---|---|
| 22.6–23.2 charging sessions per run; 0 depletions; final SoC 0.34–0.38 | `battery_summary.csv : variant : chargeSessions_mean` = 23.2 / 22.6 / 23.0 / 22.6; `depletionEvents_mean` = 0; `finalMeanSoc_mean` = 0.3747 / 0.378 / 0.3745 / 0.3442 |

## §1 / §6 headline sentences

The abstract quotes 4,740 runs, 60.4 million robot-steps, 2.9 %, 1–14 %, 0.9–3.7 % and 10.7 % below to 2.9 % above (sources above and below).

| Claim | Source |
|---|---|
| "differ by at most 2.9 %" | see §4.2 Table 1 entry above |
| "+26–29 %" dock capacity | see §4.3 |
| "7 %" window, expansions per tick −79 % (§1) | 32.3675 / 30.2912 = 1.069; `ablation_summary.csv : expansions_mean / makespan_mean` of `pact-w10` over `pact` = 0.21 |
| "up to −8 % makespan" CBS | 2.8 % at 4 robots, 8.3 % at 6 and 8 robots (`planner_summary.csv`) |
| "7–29 %" (conclusion) | window +7 %, dock +26–29 % (throughput); CBS up to −8 % is makespan and is stated separately |

## Appendix

| Claim | Source |
|---|---|
| Table 10 (layouts): sizes, free cells, endpoint counts | `src/fms/map/layouts.ts` constants; verified by `npx tsx -e` listing (small 16×10 / 104 free; warehouse 52×19 / 715; console 36×25 / 658; narrow 52×15 / 496 free, 80 pickups, 6 docks, 8 slots, 32 homes) |
| Table 9 (parameters) | `DEFAULT_CONFIG`, `DEFAULT_BATTERY` in `src/fms/sim/simulator.ts`, `src/fms/charging/policy.ts` |
| 38 tests | `npm test` output (vitest: 38 passed); the guard counts the `it(` cases in `src/fms/__tests__` |
| run limit 20,000 ticks, token-passing search bound 20,000 expansions | `DEFAULT_CONFIG.maxTicks`, `DEFAULT_CONFIG.tpMaxExpansions` |

## §5 Limitations

| Claim | Source |
|---|---|
| layouts of at most 715 free cells | `freeCellCount` of the four layouts (104 / 715 / 658 / 496) |
| each run delivers 100 or 200 tasks and ends within 4,189 ticks (first round and stress sweep) | `numTasks` and max `makespan` over the first-round and `stress.json` records |
| Node.js 22, one host | meta files `: node, cpu` |
| half-widths of 0.2 to 1.6 % (three coupling regimes inside the safe envelope) | the 12 PACT intervals of `tables/coupling.tex` in the first three regimes: half-widths 0.16–1.56 |

## Second round (§4.2 stress, §4.4–4.6, Prop. 2, Tables 2, 5, 6, 7, 14)

Every table below is generated by `scripts/paper-data.ts` (`stressTable`, `cascadeTable`,
`baselinesTable`, `couplingTable`, `reserveTable`) from the per-run JSON; "script:" lines
are printed by the same run.

| Claim | Source |
|---|---|
| Table 2 (stress), all cells | `tables/stress.tex` from `stress.json`, rows = layout × fleet × mapf, 240 runs each |
| 4,320 runs, 51.6 million robot-steps; 0 vertex, 0 swap, 0 illegal | script: `stress: runs 4320, robot-steps 51551700`; `stress: audit vertex 0, swap 0, illegal 0, sim conflicts 0` |
| normal batteries: 2,160 runs, no depletion, no stall, all delivered, longest no-progress interval 126, lowest charge 0.044 | script: `stress battery=normal: runs 2160, ... runs with depletion 0, depletions 0, stalled 0 ..., unfinished 0, max no-progress 126, ..., min SoC 0.0439` |
| doubled drain: depletion in 1,476 of 2,160 runs, 9,535 events, 227 stalled runs (all after a depletion), 510 undelivered tasks, Q up to 500 | script: `stress battery=stress: runs 2160, ... runs with depletion 1476, depletions 9535, stalled 227 (with depletion 227), unfinished 510, ..., Q 500` |
| "two thirds of the runs" (abstract) | 1476 / 2160 = 0.68 |
| 4 robots on small and 8 on narrow: 0 and 3 of 240 doubled-drain runs deplete | `stress.json` filtered to `variant` ending in `stress`, `small`/4 and `narrow`/8, runs with `depletionEvents > 0` (0 and 3; `tables/stress.tex` depletions 0+0 and 3+0) |
| CBS on larger layouts: 0.3–10 fall-back epochs per run (1.8 of ~148 on warehouse/32, 10 of ~180 on narrow/16); 8,240 of 8,242 fallbacks from the node budget; makespan pooled over both loads −1.2 to −2.6 % (the text quotes the batch-only and Poisson-only values, see the last section) (−1.9±0.6 % warehouse/32) vs −4 to −12 % on small; 3–15× PP planner time | script: `stress cbs vs pp makespan <layout>/<fleet>` lines (fallbacks/run 0.43, 1.79, 0.43, 0.33, 2.33, 10.05; epochs/run 148.5 at warehouse/32, 180.0 at narrow/16; makespan −1.65, −1.93±0.62, −1.19, −1.23, −2.61, −2.43; small −3.95, −8.73, −11.59; ms/tick ratios at `2d4342a` 1.36/0.35, 4.73/0.72, 1.54/0.44, 1.75/0.61, 0.97/0.14, 6.16/0.40 = 3.9, 6.6, 3.5, 2.9, 6.9, 15.4); `stress: CBS runs 2160, ... fallbacks from the node budget 8240 of 8242` |
| Table 14 (reserve): D_σ, W (work trips only, `audit_maxWorkTripDelay`), Q, required ρ and θ_lo, min SoC; "short by a factor of 6.6 to 18.6", "would suffice only on small", "not one of the 2,160 normal-battery runs satisfies eq. (reserve) with its own W and Q" | `tables/reserve.tex` (caption computed by `reserveTable`); script: `reserve <layout>` lines (required ρ 0.9288 / 0.4818 / 0.3298 / 0.6228 vs default 0.05 → factors 18.6 / 9.6 / 6.6 / 12.5; W=Q=0: 0.0178 / 0.0678 / 0.0568 / 0.0628; work-trip W equals all-trip W on every layout: 246 / 104 / 80 / 156; median work-trip W 38 / 37 / 40 / 38) |
| Table 5 (cascade), all cells; 27/30/10/27 runs with conflicts without repair; 24/30/0/16 with restarts; 30/30/23/30 stalled with static priorities; fallbacks within 0.63 throughput; 113 of 120 gridlocked (§5) | `tables/cascade.tex`; script: `cascade <setting>/<variant>` lines (throughputs 30.64/30.75/30.66, 33.34/33.97/33.89, 18.96/18.85/18.93, 16.53/16.63/16.69) |
| dock capacity 4: throughput 33.3, +9.0±1.4 % paired over capacity 3, holds 8.8 vs 3.5 | script: `cascade dock 4 vs dock 3 (cascade, paired throughput): 8.97 +- 1.41`; `cascade warehouse-32-dock4/cascade ... throughput 33.34, holds 8.8`; `warehouse-32/cascade ... holds 3.5` |
| Table 6 (baselines), all cells; TP −29 to −66 %, TPTS −16 to −55 % vs RH + Hungarian; "16–66 % less" | `tables/baselines.tex`; script: `baselines <setting>/<variant>` lines (TP −40.72, −66.14, −28.62, −53.88, −52.30; TPTS −30.62, −55.14, −16.25, −47.99, −40.12) |
| TPTS vs RH + Hungarian at κ_d = 1: −2.5 to +1.6 %; TP 11–26 % behind | script: `baselines <setting> tpts/tp vs hungarian-dock1` lines (TPTS 0.63, −2.45, 1.64, −0.03, −2.49; TP −14.11, −26.41, −13.54, −11.35, −22.36) |
| TPTS 23,000–93,000 A* calls per run, RH 4,600–9,200 | script: `astar` field of the baselines lines (TPTS 23216–92593; hungarian/pact 4629–9212) |
| no conflict, stall or depletion in the 300 TP/TPTS runs | script: baselines lines for tp/tpts: `violations 0, stalled 0, unfinished 0, depletions 0` |
| no search hits the 20,000-expansion bound; no swap dropped for want of a path home | script: baselines lines for tp/tpts: `swap vetoes 0.00 (max 0), search-bound hits 0` |
| Table 6 column "Paired vs. RH + Hungarian, κ_d = 1" | `tables/baselines.tex`, same numbers as the `vs hungarian-dock1` script lines |
| PACT vs Hungarian at κ_d = 1: one of five intervals excludes 0, +0.9±0.9 % (Poisson) | script: `baselines warehouse-16-poisson pact-dock1 vs hungarian-dock1 (paired throughput): 0.89 +- 0.85` |
| Table 7 (coupling), all cells; PACT's 12 intervals in the first three regimes contain 0; mean differences ≤ 1.3 % throughput, ≤ 0.6 % service; ≤ 0.5 % on long trips; proxy exclusions +1.7±1.4, −1.5±1.3, +0.6±0.5, −0.5±0.3, −0.5±0.4 | `tables/coupling.tex`; script: `coupling <regime> <a> vs <b>` lines and the `(excludes 0)` markers |
| saturated chargers: 586–641 depletion events per method over 30 runs, 10–16 stalled runs, PACT +23±18 %, proxy +24±21 %, service 0.0±2.2 %, stalled 10 (PACT) vs 16 (Hungarian); greedy vs Hungarian +20.4±22.4 %, 11 stalled (greedy); PACT vs greedy +12.5±17.2 %, proxy vs greedy +9.7±16.2 % | `tables/coupling.tex` (Saturated chargers rows); script: `coupling saturated-chargers/<method>` lines, `coupling saturated-chargers pact vs hungarian` lines and `coupling saturated-chargers <a> vs <b>` lines (greedy vs hungarian throughput 20.42 +- 22.40; pact vs greedy 12.46 +- 17.22; pact-proxy vs greedy 9.68 +- 16.21; `saturated-chargers/greedy` stalled 11) |
| Prop. 2 inputs β_m = 0.001, β_w = 0.0002, δ = 2, ρ = 0.05, θ_lo = 0.2 | `DEFAULT_BATTERY`, `DEFAULT_CONFIG` (printed into the caption of `tables/reserve.tex`) |
| doubled drain 0.002 / 0.0004; triple drain 0.003 / 0.0006 | `scripts/bench-fms.ts : BATTERY_STRESS` and the `saturated-chargers` regime |

## Claims added in the review round (all recomputed by `scripts/check-paper.ts`)

| Claim | Source |
|---|---|
| service-time intervals against Hungarian: all 36 contain zero, smallest p = 0.07, bounds up to 10.8 % (|mean| + half-width at proxy, warehouse, λ = 0.15, 16 robots), half-widths up to ±6.6 % (6.61) (§4.2; `tables/paired.tex`) | `main.json`, seed-paired `meanServiceTime`; p-values from `scripts/stats.ts` |
| makespan differs by at most 4.3 % between 16 and 32 robots under λ = 0.15 (§4.2) | `main.json : makespan`, same seed and cost model, both layouts |
| Holm's procedure over the 14 lever and planner comparisons keeps dock capacity (both cost models), window 10 and CBS at 6 robots (§4.2, §4.3, `tables/paired.tex`) | paired t-tests on `ablation.json`, `main.json`, `planner.json`; `holm()` in `scripts/stats.ts` |
| Holm over the 8 fallback comparisons keeps no-repair at capacity 4 (+2.0 ± 1.2 %); restarts +1.7 ± 1.3 % and +1.0 ± 1.0 % nominal (§4.4) | `cascade.json`, throughput of `none` / `restart` against `cascade`, seed-paired |
| A* expansions per tick: 18 / 752 / 1,021 at 4 / 32 / 48 robots (56-fold); +25 % for the path-aware cost at 48 (§4.2) | `scaling_summary.csv : expansions_mean / makespan_mean` |
| expansions per tick, window 10: 0.21 of the default; window 30: 3.5 times; h = 1: 2.2 times (§4.3); −79 % (§1) | `ablation_summary.csv : expansions_mean / makespan_mean` |
| CBS expands 1.03 / 1.32 / 1.07 times the nodes per tick of PP on small (§4.2) | `planner_summary.csv : expansions_mean / makespan_mean` |
| CBS on small: −3.9 ± 0.6, −8.7 ± 0.7, −11.6 ± 0.9 % makespan over 120 pairs; larger layouts, batch: 2.4–4.1 % over 60 pairs; Poisson: at most 2.5 %; 2.1–12.2 times the expansions per tick (§4.2) | `stress.json`, normal-battery runs, paired by seed (and load) |
| stress sweep: 100 tasks on every layout, λ = 0.3 on small; long trips: λ = 0.1 (§4.1) | `stress.json`, `coupling.json : numTasks, arrivalRate` |
| pool size max(2m, 8); infeasible offset 10^6 (§3.3, Prop. 3, appendix B) | `POOL_FACTOR`, `POOL_MIN` (`src/fms/sim/simulator.ts`), `INFEASIBLE_OFFSET` (`src/fms/alloc/hungarian.ts`) |


## Coupling diagnostics, token-passing variants (added with the regenerated records)

| Claim | Source |
|---|---|
| `tables/diagnostic.tex`: pairs per run, share beyond the window, share with estimate ≠ distance, mean gap, mean distance, share of allocations whose matching differs | `main.json`, `coupling.json`, runs with `alloc` = `pact` / `pact-proxy`: `cplPairs`, `cplPairsBeyond`, `cplPairsDiffer`, `cplGapSum`, `cplDistSum`, `cplAllocs`, `cplAllocsMatchDiffer`, summed over the seeds of a configuration; script lines "diagnostic ...". The counters are computed next to the allocation and do not feed back into it (identity of all earlier fields: `regeneration.json`) |
| twelve cells, path-aware cost: 60–86 % of pairs beyond the window; estimate differs for 6–26 %, by 1.9–3.0 ticks against a mean distance of 23–40; matching differs in 1–14 % of allocations (abstract, §1, §4.2, §5, §6) | minimum and maximum over the twelve rows of `tables/diagnostic.tex` |
| proxy: 20–58 % of pairs, 5–30 % of matchings (§4.2) | same rows, proxy columns |
| regimes: matching differs in 27 % (hotspot), 6 % (one-lane aisles), 3 % (long trips; 92 % beyond the window), 2 % (saturated chargers); "2–27 %" in §1 | last four rows of `tables/diagnostic.tex` |
| `tables/tpfree.tex` | `tpfree.json` (variants `*-interruptible`, `*-faithful`) and `baselines.json` (`tp`, `tpts`, `hungarian-dock1`), seed-paired throughput; script lines "tpfree ..." |
| TP changes by at most 1.0 % under either variant | largest absolute mean of the ten paired differences to `tp` (0.96) |
| TPTS, interruptible: +1.3 to +3.7 % over home, +0.9 to +3.7 % over the loop at capacity 1, all ten intervals exclude zero | paired differences to `tpts` and to `hungarian-dock1` |
| TPTS, published rule adapted (`tpFree: 'faithful'`): −9.7 to +2.9 % against home, −10.7 to +2.9 % against the loop at capacity 1 | same |
| "0.9–3.7 % more than our loop in every setting" (abstract, §1, §4.5, §6) | the five paired means of interruptible TPTS against `hungarian-dock1`; all five intervals above zero |
| "10.7 % below to 2.9 % above" for the adapted published rule (abstract, §1, §4.5, §6) | minimum and maximum of the five paired means of `tpts-faithful` against `hungarian-dock1` |
| Holm status (§4.5): warehouse/32 batch (p = 0.033) and narrow/16 batch (p = 0.032) do not survive Holm over the ten intervals of `tpts` and `tpts-interruptible` against `hungarian-dock1`; the other three do. The same three survive over all fifteen intervals | `holm` in `scripts/stats.ts`; guard assertion in `scripts/check-paper.ts` |
| the adapted rule has two added triggers (pickup cell of a pending task, charger slot), excludes pickups from the Path2 endpoints, and uses Path2 as the escape of a swapped robot | read off `src/fms/sim/simulator.ts` (`tpFreeFaithful`, `tpPath2`, `tpTakeTask`) by three source assertions in the guard |
| TPTS at least 12 % behind at the default capacity | smallest interval bound of the fifteen paired differences of the three TPTS variants against `hungarian` |
