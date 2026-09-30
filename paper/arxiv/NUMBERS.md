# NUMBERS.md — provenance of every number in the paper

All results live in `paper/experiments/results/` (committed). `<sweep>_summary.csv`
holds mean/std/max over seeds per configuration (row selected by `layout`, `fleetSize`,
`arrivalRate`, `variant`, `mapf`, `alloc`); `<sweep>.json` holds one record per run,
including the independent auditor's `audit_*` fields.
`scripts/paper-data.ts` regenerates `tables/*.tex` and `figures/data/*.csv` from these
files and prints summary lines (quoted below as "script: ...") for every number that
appears in the text but not in a table. Notation: `file : row-selector : field`.

The first-round sweeps (main, planner, scaling, ablation, battery; seeds 1–5) were produced at
commit `27080ab` in one process (`bench-meta-main-planner-scaling-ablation-battery.json`).
The second-round sweeps (stress, cascade, baselines, coupling) were first run at `27080ab`
(results commit `dccf403`) and re-run at `2d4342a` on 10 worker processes
(`bench-meta-stress-cascade-baselines-coupling.json`); `2d4342a` only adds recorded fields
(`audit_maxWorkTripDelay`, `cbsBudgetExceeded`, `tpSearchLimitHits`, `tpSwapVetoes`), and every
non-timing field of all 6,180 re-run records equals the `dccf403` record (compared field by field,
0 differences). The second-round sweep definitions are in `4a72ff1` (`scripts/bench-fms.ts`), which
precedes both result commits; `git diff 4a72ff1 2d4342a -- scripts/bench-fms.ts` touches only the
list of recorded fields. Git shows commit order only, which is what §4.1 now claims.

## Bench-wide totals (abstract, §1, §4.2 "Correctness", §6)

| Claim | Source |
|---|---|
| 420 runs; 0 conflicts (simulator and auditor); 0 deadlocks; 0 depletions; 109 s wall | `bench-meta-main-planner-scaling-ablation-battery.json : runs 420, totalConflicts 0, auditVertexConflicts 0, auditSwapConflicts 0, auditIllegalMoves 0, totalDeadlocks 0, totalDepletions 0, wallSeconds 108.6`; script: `original sweeps (seeds 1-5): ... audit vertex 0, swap 0, illegal 0, depletions 0, sim conflicts 0, stalled 0, unfinished 0` |
| re-running the first round at the final code reproduces every non-timing field | every record of the five first-round `*.json` compared field by field (except `wallMs`, `plannerMs`, `allocMs`, `plannerMsPerTick`) against the previous committed results (commit `74922c7`/`0e53c4c`): 0 differences in 420 runs |
| every run delivers all of its tasks | sum of `tasksUnfinished` over all 420 records = 0 (longest run: `makespan` 4189, scaling sweep) |
| 8,833,050 robot-ticks ("8.8 million robot-steps") | script: `original sweeps (seeds 1-5): runs 420, robot-steps 8833050` (sum of `audit_robotTicks` = `makespan * fleetSize`) |
| 5,317,603 move actions; 72,823 wait actions | sum of `moveActions` / `waitActions` over the same records |
| 81,000 delivered tasks | sum of `tasksCompleted` over the same records (390 runs × 200 + 30 runs × 100) |
| commit of the benchmarked code `27080ab` (first round), `2d4342a` (second round, behaviour-identical) | both meta files `: commit` |
| CPU "AMD Ryzen 5 5500GT", Node 22 | `bench-meta-main-planner-scaling-ablation-battery.json : cpu, node` |
| seeds 1–5 / 1–60 / 1–30 | meta files `: seeds` |
| 6,180 second-round runs on 10 worker processes, 967 s | `bench-meta-stress-cascade-baselines-coupling.json : runs 6180, workers 10, wallSeconds 966.8` |
| 4,740 runs, 60.4 million robot-steps, no executed conflict (abstract, §1, §6) | script: `first round + stress: runs 4740, robot-steps 60384750, audit vertex+swap+illegal 0` |

## §4.2 Main results, Table 1 (`tables/main.tex`)

Every cell: `main_summary.csv : layout, fleetSize, arrivalRate ∈ {0.15, inf}, variant ∈ {greedy, hungarian, pact-proxy, pact} : throughput_mean/std, meanServiceTime_mean/std`.

| Claim | Source |
|---|---|
| ≤ 2.9 % throughput spread in every cell; worst cell warehouse/32/batch: 29.7 greedy, 30.6 Hungarian, 30.6 Proxy, 30.3 PACT | `main_summary.csv : warehouse, 32, inf : throughput_mean` = 29.7237 / 30.5503 / 30.5988 / 30.2912 → (30.5988−29.7237)/30.5988 = 2.86 % ≤ 2.9 % |
| "within one standard deviation": max std per cell ≤ 2.6 | `main_summary.csv : throughput_std` (max 2.6 at console/32/inf) |
| 233–297 wait actions per run (warehouse, 32, batch) | `main_summary.csv : warehouse, 32, inf, hungarian/greedy : waitActions_mean` = 233.4 (min) / 296.8 (max) |
| service 282–287, queueing 216–220 (warehouse, 32, batch) | `main_summary.csv : warehouse, 32, inf, * : meanServiceTime_mean` = 282.5–287.4; `meanWaitTime_mean` = 216.3–220.1 |
| holds ≤ 5.2 per run in the main sweep | max of `main_summary.csv : holdEvents_mean` = 5.2 (console, 32, inf, hungarian) |
| "about 1.4 waits per task": 274 waits vs 14.9 thousand moves (273.8 / 200 = 1.37) | `main_summary.csv : warehouse, 32, inf, pact : waitActions_mean` = 273.8; `moveActions_mean` = 14937.2 |

## §4.2 Planner backend, Table 3 (`tables/planner.tex`), Fig. 2 left/centre (`figures/data/planner_pp.csv`, `planner_cbs.csv`)

| Claim | Source |
|---|---|
| makespan −2.8 % / −8.3 % / −8.3 % at 4 / 6 / 8 robots | `planner_summary.csv : fleetSize, variant=pp/cbs : makespan_mean` = 789.0→766.6, 561.6→515.0, 513.4→470.8 |
| wait actions −19 / −24 / −31 % | `waitActions_mean` = 59.6→48.2, 134.6→102.4, 213.6→148.0 |
| service time −6–10 % | `meanServiceTime_mean` = 318.1→300.3 (−5.6 %), 262.0→238.8 (−8.9 %), 242.1→218.0 (−9.9 %) |
| 0.09–0.34 planner ms/tick (CBS; §4.2 and §5) | `plannerMsPerTick_mean` for cbs = 0.0902, 0.3114, 0.3366 (wall-clock field) |
| seed-paired CBS makespan −2.8±2.1 / −8.2±3.6 / −8.2±4.3 % | `tables/paired.tex` (bottom block), computed by `scripts/paper-data.ts : pairedTable` from `planner.json` |
| 0.6 fallbacks per run at 6 robots, 0 elsewhere | `cbsFallbacks_mean` = 0, 0.6, 0 |

## §4.2 Scaling, Fig. 3 (`figures/data/scaling_*.csv`), Table 12 (`tables/scaling.tex`)

| Claim | Source |
|---|---|
| throughput 4.9 → 33.7 tasks/100 ticks | `scaling_summary.csv : fleetSize=4, hungarian : throughput_mean` = 4.9019; `fleetSize=48, pact` = 33.654 |
| flattens beyond 40 robots; utilisation 0.41 at 48 | `throughput_mean` 33.02 (40, hungarian) vs 33.25 (48); `utilization_mean` = 0.4056 (48, hungarian) |
| service time 1909 → 252 ticks | `meanServiceTime_mean` = 1909.468 (4, hungarian) / 252.225 (48, hungarian) |
| planner 0.02 → 0.75 ms/tick Hungarian, 0.97 PACT; "0.02–0.97 ms" in §5 | `plannerMsPerTick_mean` = 0.0198 (4, hungarian), 0.7541 (48, hungarian), 0.9745 (48, pact) |
| +35 % A* calls at 48 robots: 16,229 vs 12,021 | `astarCalls_mean` = 16229.4 (48, pact) / 12021.4 (48, hungarian) |
| dock bound "9 docks × κ_d = 3" | layout constant (warehouse docks = 9, `WAREHOUSE_SPEC`) × `DEFAULT_CONFIG.dockCapacity` |

## §4.3 Ablations, Table 4 (`tables/ablation.tex`), Fig. 2 right (`figures/data/window.csv`)

All rows: `ablation_summary.csv : variant : throughput_mean, meanServiceTime_mean, waitActions_mean, holdEvents_mean, plannerMsPerTick_mean, utilization_mean`.

| Claim | Source |
|---|---|
| dock capacity 2: 24.0 (PACT) / 23.7 (Hungarian) vs 30.3 / 30.6 → +26 / +29 % for capacity 3 | `pact-dock2 : throughput_mean` = 23.9853, `hungarian-dock2` = 23.6748; defaults `main_summary.csv : warehouse, 32, inf, pact/hungarian` = 30.2912 / 30.5503 |
| utilisation 0.64 → 0.42 | `pact : utilization_mean` = 0.6362; `pact-dock2` = 0.4175 |
| capacity 4 gridlocked 2 of 30 development runs | development stress run under an earlier priority scheme, not part of the committed benchmark (stated as such in the text) |
| w=10: 32.4 (+7 %), waits 150 vs 274, 0.19 vs 0.61 ms/tick | `pact-w10 : throughput_mean` = 32.3675, `waitActions_mean` = 149.8, `plannerMsPerTick_mean` = 0.1868; `pact` = 30.2912 / 273.8 / 0.6109 |
| w=30: 28.2 (−7 %), 1.96 ms/tick | `pact-w30` = 28.2265 / 1.9584 |
| h=1: 30.3 at 2.2× planner time | `pact-h1 : throughput_mean` = 30.254, `plannerMsPerTick_mean` = 1.3451 (1.3451 / 0.6109 = 2.20) |
| no event epochs: −1–5 % throughput, +55–125 waits | `pact-noEvent` = 29.9066 (−1.3 %), waits 329.2 (+55.4); `hungarian-noEvent` = 28.925 vs 30.5503 (−5.3 %), waits 358.6 vs 233.4 (+125.2) |
| battery term neutral (< 0.5: +0.01 PACT, −0.43 Hungarian) | `pact-noBattery` 30.3025 vs `pact` 30.2912; `hungarian-noBattery` 30.119 vs `main_summary.csv : warehouse, 32, inf, hungarian` 30.5503 |
| K = 3 / 12 change ≤ 0.2 | `pact-K3` = 30.234, `pact-K12` = 30.4203 vs 30.2912 |


## Seed-paired comparisons, Table 11 (`tables/paired.tex`), §1, §4.2, §4.3, §6

Computed by `scripts/paper-data.ts : pairedTable()` from the per-run records (`main.json`, `ablation.json`, `planner.json`): per-seed relative difference `100·(x_variant − x_base)/x_base`, mean and two-sided 95 % Student-t half-width with 4 degrees of freedom (t = 2.776). The script prints the summary lines quoted below.

| Claim | Source |
|---|---|
| 35 of 36 cost-model intervals vs Hungarian contain 0; the exception PACT console/32/batch −2.3±2.0 % | script summary `intervals containing 0: 35; excluding 0: console/inf/32: -2.29 +- 2.02` |
| every interval within ±3.7 % under Poisson load and ±7.1 % under batch load ("about 4 %" / "about 7 %" in §1) | script summary `largest |interval bound| ... 7.06% (console/inf/8); under Poisson load: 3.71%` |
| 1.8 exclusions expected by chance | 36 × 0.05 |
| window w=10 +6.9±1.6 %, w=30 −6.9±3.9 % | script summary lines `window $w{=}10$` / `$w{=}30$` |
| dock capacity 2 costs 20.7±3.3 % (PACT) / 22.5±2.2 % (Hungarian) | script summary lines `dock capacity 2` |
| no event epochs: Hungarian −5.2±3.3 %, PACT −1.2±5.2 % | script summary lines `no event epochs` |

## §4.2 Battery stress, Table 13 (`tables/battery.tex`)

| Claim | Source |
|---|---|
| 22.6–23.2 charging sessions per run; 0 depletions; final SoC 0.34–0.38 | `battery_summary.csv : variant : chargeSessions_mean` = 23.2 / 22.6 / 23.0 / 22.6; `depletionEvents_mean` = 0; `finalMeanSoc_mean` = 0.3747 / 0.378 / 0.3745 / 0.3442 |

## §1 / §6 headline sentences

| Claim | Source |
|---|---|
| "differ by at most 2.9 %" | see §4.2 Table 1 entry above |
| "+26–29 %" dock capacity | see §4.3 |
| "7 %" window, "3.3×" planner time | 32.3675 / 30.2912 = 1.069; 0.6109 / 0.1868 = 3.27 |
| "−8 % makespan" CBS | 8.3 % at 6 and 8 robots (`planner_summary.csv`) |
| "7–29 %" (conclusion) | window +7 %, dock +26–29 % (throughput); CBS −8 % is makespan and is stated separately |

## Appendix

| Claim | Source |
|---|---|
| Table 10 (layouts): sizes, free cells, endpoint counts | `src/fms/map/layouts.ts` constants; verified by `npx tsx -e` listing (small 16×10 / 104 free; warehouse 52×19 / 715; console 36×25 / 658; narrow 52×15 / 496 free, 80 pickups, 6 docks, 8 slots, 32 homes) |
| Table 9 (parameters) | `DEFAULT_CONFIG`, `DEFAULT_BATTERY` in `src/fms/sim/simulator.ts`, `src/fms/charging/policy.ts` |
| 34 tests | `npm test` output (vitest: 34 passed) |

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
| CBS on larger layouts: 0.3–10 fall-back epochs per run (1.8 of ~148 on warehouse/32, 10 of ~180 on narrow/16); 8,240 of 8,242 fallbacks from the node budget; makespan −1.2 to −2.6 % (−1.9±0.6 % warehouse/32) vs −4 to −12 % on small; 3–15× PP planner time | script: `stress cbs vs pp makespan <layout>/<fleet>` lines (fallbacks/run 0.43, 1.79, 0.43, 0.33, 2.33, 10.05; epochs/run 148.5 at warehouse/32, 180.0 at narrow/16; makespan −1.65, −1.93±0.62, −1.19, −1.23, −2.61, −2.43; small −3.95, −8.73, −11.59; ms/tick ratios at `2d4342a` 1.36/0.35, 4.73/0.72, 1.54/0.44, 1.75/0.61, 0.97/0.14, 6.16/0.40 = 3.9, 6.6, 3.5, 2.9, 6.9, 15.4); `stress: CBS runs 2160, ... fallbacks from the node budget 8240 of 8242` |
| Table 14 (reserve): D_σ, W (work trips only, `audit_maxWorkTripDelay`), Q, required ρ and θ_lo, min SoC; "short by a factor of 6.6 to 18.6", "would suffice only on small", "not one of the 2,160 normal-battery runs satisfies eq. (reserve) with its own W and Q" | `tables/reserve.tex` (caption computed by `reserveTable`); script: `reserve <layout>` lines (required ρ 0.9288 / 0.4818 / 0.3298 / 0.6228 vs default 0.05 → factors 18.6 / 9.6 / 6.6 / 12.5; W=Q=0: 0.0178 / 0.0678 / 0.0568 / 0.0628; work-trip W equals all-trip W on every layout: 246 / 104 / 80 / 156; median work-trip W 38 / 37 / 40 / 38) |
| Table 5 (cascade), all cells; 27/30/10/27 runs with conflicts without repair; 24/30/0/16 with restarts; 30/30/23/30 stalled with static priorities; fallbacks within 0.7 throughput; 113 of 120 gridlocked (§5) | `tables/cascade.tex`; script: `cascade <setting>/<variant>` lines (throughputs 30.64/30.75/30.66, 33.34/33.97/33.89, 18.96/18.85/18.93, 16.53/16.63/16.69) |
| dock capacity 4: throughput 33.3, +9.0±1.4 % paired over capacity 3, holds 8.8 vs 3.5 | script: `cascade dock 4 vs dock 3 (cascade, paired throughput): 8.97 +- 1.41`; `cascade warehouse-32-dock4/cascade ... throughput 33.34, holds 8.8`; `warehouse-32/cascade ... holds 3.5` |
| Table 6 (baselines), all cells; TP −29 to −66 %, TPTS −16 to −55 % vs RH + Hungarian; "16–66 % less" | `tables/baselines.tex`; script: `baselines <setting>/<variant>` lines (TP −40.72, −66.14, −28.62, −53.88, −52.30; TPTS −30.62, −55.14, −16.25, −47.99, −40.12) |
| TPTS vs RH + Hungarian at κ_d = 1: −2.5 to +1.6 %; TP 11–26 % behind | script: `baselines <setting> tpts/tp vs hungarian-dock1` lines (TPTS 0.63, −2.45, 1.64, −0.03, −2.49; TP −14.11, −26.41, −13.54, −11.35, −22.36) |
| TPTS 23,000–93,000 A* calls per run, RH 4,600–9,200 | script: `astar` field of the baselines lines (TPTS 23216–92593; hungarian/pact 4629–9212) |
| no conflict, stall or depletion in the 300 TP/TPTS runs | script: baselines lines for tp/tpts: `violations 0, stalled 0, unfinished 0, depletions 0` |
| no search hits the 20,000-expansion bound; no swap dropped for want of a path home | script: baselines lines for tp/tpts: `swap vetoes 0.00 (max 0), search-bound hits 0` |
| Table 6 column "Paired vs. RH + Hungarian, κ_d = 1" | `tables/baselines.tex`, same numbers as the `vs hungarian-dock1` script lines |
| PACT vs Hungarian at κ_d = 1: one of five intervals excludes 0, +0.9±0.9 % (Poisson) | script: `baselines warehouse-16-poisson pact-dock1 vs hungarian-dock1 (paired throughput): 0.89 +- 0.85` |
| Table 7 (coupling), all cells; PACT's 12 intervals in the first three regimes contain 0; mean differences ≤ 1.3 % throughput, ≤ 0.6 % service; ≤ 0.5 % on long trips; proxy exclusions +1.7±1.4, −1.5±1.3, +0.6±0.5, −0.5±0.3, −0.5±0.4 | `tables/coupling.tex`; script: `coupling <regime> <a> vs <b>` lines and the `(excludes 0)` markers |
| saturated chargers: 586–641 depletion events per method over 30 runs, 10–16 stalled runs, PACT +23±18 %, proxy +24±21 %, service 0.0±2.2 %, stalled 10 (PACT) vs 16 (Hungarian) | script: `coupling saturated-chargers/<method>` lines and `coupling saturated-chargers pact vs hungarian` lines |
| Prop. 2 inputs β_m = 0.001, β_w = 0.0002, δ = 2, ρ = 0.05, θ_lo = 0.2 | `DEFAULT_BATTERY`, `DEFAULT_CONFIG` (printed into the caption of `tables/reserve.tex`) |
| doubled drain 0.002 / 0.0004; triple drain 0.003 / 0.0006 | `scripts/bench-fms.ts : BATTERY_STRESS` and the `saturated-chargers` regime |
