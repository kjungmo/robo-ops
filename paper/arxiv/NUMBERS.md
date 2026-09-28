# NUMBERS.md — provenance of every number in the paper

All results live in `paper/experiments/results/` (committed). `<sweep>_summary.csv`
holds mean/std over seeds per configuration (row selected by `layout`, `fleetSize`,
`arrivalRate`, `variant`, `mapf`); `<sweep>.json` holds one record per run.
`scripts/paper-data.ts` regenerates `tables/*.tex` and `figures/data/*.csv` from these
files. Notation: `file : row-selector : field`.

## Bench-wide totals (abstract, §1, §4.2 "Correctness", §6)

| Claim | Source |
|---|---|
| 420 runs; 0 conflicts; 0 deadlocks; 0 depletions; 104 s wall | `bench-meta.json : runs, totalConflicts, totalDeadlocks, totalDepletions, wallSeconds (103.8)` |
| 8,833,050 robot-ticks ("8.8 million robot-steps") | sum over all records in `main.json, planner.json, scaling.json, ablation.json, battery.json` of `makespan * fleetSize` |
| 5,317,603 move actions; 72,823 wait actions | sum of `moveActions` / `waitActions` over the same records |
| 81,000 delivered tasks | sum of `tasksCompleted` over the same records (390 runs × 200 + 30 runs × 100) |
| commit of the benchmarked code `74922c7` | `bench-meta.json : commit` |
| CPU "AMD Ryzen 5 5500GT", Node 22 | `bench-meta.json : cpu, node` |
| 5 seeds (1–5) | `bench-meta.json : seeds` |

## §4.2 Main results, Table 1 (`tables/main.tex`)

Every cell: `main_summary.csv : layout, fleetSize, arrivalRate ∈ {0.15, inf}, variant ∈ {greedy, hungarian, pact-proxy, pact} : throughput_mean/std, meanServiceTime_mean/std`.

| Claim | Source |
|---|---|
| ≤ 2.9 % throughput spread in every cell; worst cell warehouse/32/batch: 29.7 greedy, 30.6 Hungarian, 30.6 Proxy, 30.3 PACT | `main_summary.csv : warehouse, 32, inf : throughput_mean` = 29.6968 / 30.5503 / 30.5666 / 30.2912 → (30.57−29.70)/30.57 = 2.9 % |
| "within one standard deviation": max std per cell ≤ 2.6 | `main_summary.csv : throughput_std` (max 2.6 at console/32/inf) |
| 233–297 wait actions per run (warehouse, 32, batch) | `main_summary.csv : warehouse, 32, inf, hungarian/greedy : waitActions_mean` = 233.4 (min) / 296.8 (max) |
| service 282–287, queueing 216–220 (warehouse, 32, batch) | `main_summary.csv : warehouse, 32, inf, * : meanServiceTime_mean` = 282.5–287.4; `meanWaitTime_mean` = 216.3–220.1 |
| holds ≤ 5.2 per run in the main sweep | max of `main_summary.csv : holdEvents_mean` = 5.2 (console, 32, inf, hungarian) |
| "about 1.4 waits per task": 274 waits vs 14.9 thousand moves (273.8 / 200 = 1.37) | `main_summary.csv : warehouse, 32, inf, pact : waitActions_mean` = 273.8; `moveActions_mean` = 14937.2 |

## §4.2 Planner backend, Table 2 (`tables/planner.tex`), Fig. 2 left/centre (`figures/data/planner_pp.csv`, `planner_cbs.csv`)

| Claim | Source |
|---|---|
| makespan −2.8 % / −8.3 % / −8.3 % at 4 / 6 / 8 robots | `planner_summary.csv : fleetSize, variant=pp/cbs : makespan_mean` = 789.0→766.6, 561.6→515.0, 513.4→470.8 |
| wait actions −19 / −24 / −31 % | `waitActions_mean` = 59.6→48.2, 134.6→102.4, 213.6→148.0 |
| service time −6–10 % | `meanServiceTime_mean` = 318.1→300.3 (−5.6 %), 262.0→238.8 (−8.9 %), 242.1→218.0 (−9.9 %) |
| 0.09–0.31 planner ms/tick (CBS) | `plannerMsPerTick_mean` for cbs = 0.0863, 0.3045, 0.3075 |
| 0.6 fallbacks per run at 6 robots, 0 elsewhere | `cbsFallbacks_mean` = 0, 0.6, 0 |

## §4.2 Scaling, Fig. 3 (`figures/data/scaling_*.csv`), Table 7 (`tables/scaling.tex`)

| Claim | Source |
|---|---|
| throughput 4.9 → 33.7 tasks/100 ticks | `scaling_summary.csv : fleetSize=4, hungarian : throughput_mean` = 4.9019; `fleetSize=48, pact` = 33.654 |
| flattens beyond 40 robots; utilisation 0.41 at 48 | `throughput_mean` 33.02 (40, hungarian) vs 33.25 (48); `utilization_mean` = 0.4056 (48, hungarian) |
| service time 1909 → 252 ticks | `meanServiceTime_mean` = 1909.468 (4, hungarian) / 252.225 (48, hungarian) |
| planner 0.02 → 0.77 ms/tick Hungarian, 1.00 PACT | `plannerMsPerTick_mean` = 0.0183 (4, hungarian), 0.7678 (48, hungarian), 1.0007 (48, pact) |
| +35 % A* calls at 48 robots: 16,229 vs 12,021 | `astarCalls_mean` = 16229.4 (48, pact) / 12021.4 (48, hungarian) |
| dock bound "9 docks × κ_d = 3" | layout constant (warehouse docks = 9, `WAREHOUSE_SPEC`) × `DEFAULT_CONFIG.dockCapacity` |

## §4.3 Ablations, Table 3 (`tables/ablation.tex`), Fig. 2 right (`figures/data/window.csv`)

All rows: `ablation_summary.csv : variant : throughput_mean, meanServiceTime_mean, waitActions_mean, holdEvents_mean, plannerMsPerTick_mean, utilization_mean`.

| Claim | Source |
|---|---|
| dock capacity 2: 24.0 (PACT) / 23.7 (Hungarian) vs 30.3 / 30.6 → +26 / +29 % for capacity 3 | `pact-dock2 : throughput_mean` = 23.9853, `hungarian-dock2` = 23.6748; defaults `main_summary.csv : warehouse, 32, inf, pact/hungarian` = 30.2912 / 30.5503 |
| utilisation 0.64 → 0.42 | `pact : utilization_mean` = 0.6362; `pact-dock2` = 0.4175 |
| capacity 4 gridlocked 2 of 30 development runs | development stress run under an earlier priority scheme, not part of the committed benchmark (stated as such in the text) |
| w=10: 32.4 (+7 %), waits 150 vs 274, 0.18 vs 0.63 ms/tick | `pact-w10 : throughput_mean` = 32.3675, `waitActions_mean` = 149.8, `plannerMsPerTick_mean` = 0.1833; `pact` = 30.2912 / 273.8 / 0.6255 |
| w=30: 28.2 (−7 %), 1.98 ms/tick | `pact-w30` = 28.2265 / 1.9809 |
| h=1: 30.3 at 2.2× planner time | `pact-h1 : throughput_mean` = 30.254, `plannerMsPerTick_mean` = 1.3606 (1.3606 / 0.6255 = 2.18) |
| no event epochs: −1–5 % throughput, +55–125 waits | `pact-noEvent` = 29.9066 (−1.3 %), waits 329.2 (+55.4); `hungarian-noEvent` = 28.925 vs 30.5503 (−5.3 %), waits 358.6 vs 233.4 (+125.2) |
| battery term neutral (< 0.5: +0.01 PACT, −0.43 Hungarian) | `pact-noBattery` 30.3025 vs `pact` 30.2912; `hungarian-noBattery` 30.119 vs `main_summary.csv : warehouse, 32, inf, hungarian` 30.5503 |
| K = 3 / 12 change ≤ 0.2 | `pact-K3` = 30.234, `pact-K12` = 30.4203 vs 30.2912 |


## §4.2 Battery stress, Table 8 (`tables/battery.tex`)

| Claim | Source |
|---|---|
| 22.6–23.2 charging sessions per run; 0 depletions; final SoC 0.34–0.38 | `battery_summary.csv : variant : chargeSessions_mean` = 23.2 / 22.6 / 23.0 / 22.6; `depletionEvents_mean` = 0; `finalMeanSoc_mean` = 0.3747 / 0.378 / 0.3745 / 0.3442 |

## §1 / §6 headline sentences

| Claim | Source |
|---|---|
| "differ by at most 2.9 %" | see §4.2 Table 1 entry above |
| "+26–29 %" dock capacity | see §4.3 |
| "7 %" window, "3.4×" planner time | 32.3675 / 30.2912 = 1.069; 0.6255 / 0.1833 = 3.41 |
| "−8 % makespan" CBS | 8.3 % at 6 and 8 robots (`planner_summary.csv`) |
| "7–29 %" (conclusion) | window +7 %, dock +26–29 %, CBS −8 % |

## Appendix

| Claim | Source |
|---|---|
| Table 6 (layouts): sizes, free cells, endpoint counts | `src/fms/map/layouts.ts` constants; verified by `npx tsx -e` listing (small 16×10 / 104 free; warehouse 52×19 / 715; console 36×25 / 658) |
| Table 5 (parameters) | `DEFAULT_CONFIG`, `DEFAULT_BATTERY` in `src/fms/sim/simulator.ts`, `src/fms/charging/policy.ts` |
| 17 tests | `npm test` output (vitest: 17 passed) |
