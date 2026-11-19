# Changes of the second draft (v2) against the first draft (v1)

The first draft was never submitted or posted, so there is no public erratum. This file records what
changed after the external deep review of 2026-10-29, as judged in its adjudication (ruling section 4),
so that the numbers in `NUMBERS.md` and the history stay traceable. Item numbers (2, 4.2-3, A1, O1, ...)
are those of the ruling.

Commits of the work (all on branch `paper/v2-deepreview`):

| Stage | Commits |
|---|---|
| code stage: allocation-shape counters (schema 2), diagnostic block timed apart, epoch latency in the timing script | `22431e9` and earlier (`5534278`, `e98f1a9`, `692a6f3`) |
| pre-registration, before any result of the three sweeps exists | `f35437f` (adds `paper/experiments/PREREG_v2.md` and nothing else) |
| the three new sweeps and the `held` / `blocking` priority schemes | `e66bf50` (code), `acbfe97` (results), `6b64f93` (regeneration of all 8,340 records) |
| quiet-host timing with epoch latency | `eb6ec74` |
| paper edits and this changelog | the commit that adds this file |

## 1. Claims that changed

| Where | v1 | v2 | Why |
|---|---|---|---|
| abstract, §1, §4.2, §5, §6 | the reservation-aware cost is inert "since most pickups lie beyond its window" | three causes: the window, the dock gate and event-triggered epochs; only 9-26 % of the allocation calls have at least two robots and two tasks; greedy and Hungarian return the same matching in 91-99 % of the calls. The dock gate is named as a cause under batch load only (pool of one task in 81-87 % of the calls with 32 robots); under the Poisson load the pool of one task (74-75 %) is small largely because few tasks are pending, which no committed counter measures, so it is stated as a mechanism without a number (review round 1) | W2, I1, D1, E1a; counters of the code stage |
| abstract, §4.2, §5 | "greedy is not measurably worse than optimal assignment" | the same, with the share of calls in which the two agree; repeated in a regime where they decide 10-26 % of the calls differently (agreement 74-90 %; 23-26 % in the warehouse cell, 10-11 % in the console cell; review round 1 corrected "a quarter or more") | E1b |
| §1, §4.2, §5 | (not said) | the cost still acts in degenerate calls: 63 of 95 matching changes in the warehouse with 32 robots under batch load | O1 |
| abstract, §1, §5, §6 | null result about "the coupling" | null result scoped to allocation under a dock-capacity gate, with event-triggered epochs in the twelve main cells and without them in two 32-robot cells (review round 1: "binding" dropped, because the gate is not the cause of the pool of one under the Poisson load; the no-event result is part of the scope) | ruling 4.3-1 |
| title, abstract, Corollary 1, §3, §5 | conflict-free execution, unqualified | "under synchronous unit-time execution"; one sentence on delayed execution with Hönig et al. (2019) and Atzmon et al. (2020) | P2, R2 |
| §4.2 | "two design choices bound what the cost can see: K = 6 and the window" | K is not listed any more; K was varied in two cells where it binds and changed nothing measurable (the intro and the conclusion say "in two cells"; the executed run differs from K = 6 in all seeds but 14 of 30 at K = 12 in warehouse-8-batch; the pool > K share is not reported) | E2, O3, O6 |
| §5 Limitations | "more priced candidates would make it stronger" | removed; the K sweep says it does not | E2 |
| §4.4 | "the cascade's re-plans cost up to about 2 % of throughput" | withdrawn: the reference variants execute 15.0 conflicts per run on average (up to 41) with capacity-4 docks, so their throughput is not comparable | A1 |
| §4.4, §5 | "planning held and blocking robots first is what keeps the loop live" | held-first ordering alone keeps every run live and is 0.7-3.0 % below the full dynamic ordering; blocking-first alone stalls 16 of 120 runs; the paper credits the dynamic ordering as a whole | A2, D-m2, 4.2-4 |
| §4.6 long trips | "exclude effects above 0.5 %" | quoted for service time only; throughput there is set by the last arrival (the four methods finish within 2-31 ticks of each other on a seed) | A3 |
| §4.6 saturated chargers | throughput gain "mostly reflects fewer stalled runs" | with the 1,001-tick stall tail removed the difference is +4.7 %, against +15.0 % for the means with the tail | A4a |
| §5 cost analysis | "affordable" for 0.02-0.98 ms per tick | scoped to the means of prioritized planning; per-epoch times added; one windowed CBS epoch on the large layouts took up to 476 ms (median repeat), CBS averages 4.9-5.0 ms per tick there. "Below 8 ms in every epoch we timed" (review round 1: false for the ablation rows) now reads "in every epoch of the rows of tab:epoch", with 15.4 ms (16.6 ms slowest repeat) for window 30 and 10.1 ms for K = 12 | E4, O4 |
| §5 coupling regimes | "interval half-widths of 0.2 to 1.6 %" | service-time half-widths of 0.4 to 0.7 % (the 0.2 was a long-trips throughput interval, tight by construction) | review round 1 |
| §5 limitations | "a few percent" for the five-seed intervals | "a few percent under the Poisson load and about 7 % in the noisiest batch cell" | D-m1 |

## 2. New counters, tables and definitions

- Counters of schema 2 (`allocCalls`, `allocM1`, `allocPool1`, `allocNondegenerate`, `allocGreedyEqHungarian`,
  `cplAllocsMatchDifferNondegenerate`): they read state only. The regeneration at `22431e9` left all 7,200 earlier
  records identical in every earlier field; the regeneration at `acbfe97` left all 8,340 records identical in every field.
- Table 3 (`tab:diagnostic`) has two new columns: min(m, pool) >= 2 and greedy = Hungarian, for the DOCKET runs of each row.
- Table 8 (`tab:cascade`) has the column "Conflicts / run (max)" in place of the total.
- New tables: `tab:nondeg` (§4.7), `tab:kabl` (§4.3), `tab:split` (§4.4), `tab:epoch` (§4.2), all generated by `scripts/paper-data.ts`.
- Definitions: Eq. (1) is a mean over the delivered tasks (A4b, O5); throughput and makespan (stalled or time-limited runs);
  utilisation (E-m1); the congestion proxy as implemented, with a hold of any start time (C1); the arrival time as "the earliest
  tick from which the goal can be held until the horizon", and the weaker dwell-only goal test of the token-passing baselines (P1, A5), also in the list of adaptations;
  distances cached per goal cell (P-m1); the hold-overwrite sentence in the proof of Proposition 1 (P3); `Q` counts moving and waiting ticks (C2b);
  the pointer from Algorithm 2 to the robots written by CBS (P-m2).
- Not changed, by decision: the congestion proxy code (C1), the goal test (P1, A5), the headline totals of the abstract
  (4,740 runs, 60.4 million robot-steps keep their v1 definition: first round plus stress sweep).

## 3. New runs

Pre-registered in `paper/experiments/PREREG_v2.md`, commit `f35437f`, which adds that file alone before any record of these
sweeps exists. Seeds 1-30, paired by seed, Holm within the pre-registered family. The statistics are in `paper/experiments/analysis/v2.json`
(`npm run analyze:v2`), recomputed and compared byte for byte by `npm run check:paper`.

| Sweep | Runs | What | Result |
|---|---|---|---|
| `nondegenerate` | 720 | warehouse and console, 32 robots, batch, event epochs off (primary), on (reference), off with capacity 4 (optional); four cost models | DOCKET vs Hungarian +0.4 ± 1.1 % and +0.6 ± 1.5 %, p = 0.43 and 0.42, neither rejected by Holm; the v1 hint (+3.3 ± 3.0 %, n = 5) does not replicate |
| `kablation` | 180 | K in {3, 6, 12}, DOCKET, warehouse-8-batch and narrow-16-batch | K binds (3.4 / 6.6 / 8.9 and 4.1 / 6.0 / 7.1 priced pairs per call); throughput within 0.8 % of K = 6, none of four rejected |
| `prioritysplit` | 240 | held-first only and blocking-first only on the four cascade settings | see §1 of this file; all eight primary comparisons against static priorities rejected |

**Post-hoc origin of `nondegenerate`.** The configuration was chosen after the v1 ablation had shown DOCKET without event epochs
+3.32 ± 2.97 % above Hungarian (5 seeds, nominal p = 0.036, not corrected). The paper and the
pre-registration say so: the test is confirmatory of a post-hoc observation, not blind.

Deviations recorded in the pre-registration: the timing run waited up to 1,800 s (default 600) for a quiet host; the pre-registered
decision rule for the priority split returns "needs the combination" for the two warehouse settings although held-first alone avoids all stalls, and
the paper reports both facts. Added in review round 1 (Deviations 4-6 of `PREREG_v2.md`, appended, not edited in place):
(4) the implemented rule of E4 omits the clause "the other arm is not rejected against static", which no setting meets (all eight primary comparisons are rejected); it changes one verdict, `small-8`, where the written rules give no verdict and the implementation returns "blocking-first accounts"; the attribution to the dynamic ordering as a whole does not change;
(5) the secondary family of E2 (46 contrasts, Holm over all of them) was fixed when the analysis was written, and the one contrast that survives (DOCKET vs greedy service time, dock 4) is not among those listed in the pre-registration;
(6) the share of calls with pool > K is not reported (not a recorded counter; adding one would change `src/fms` after the timing run), and the first definition of `identicalToK6` counted the priced pairs, which differ by construction.

Not run, by design (outside the approved scope): the 1,440-run TOST re-run of the twelve main cells; an IStay-style conflict-free fallback.

## 4. Totals

| | v1 | v2 |
|---|---|---|
| runs, all sweeps | 7,200 | 8,340 (13 sweeps) |
| robot-steps, all sweeps | 138,025,414 | 161,150,534 |
| runs / robot-steps in the abstract (first round plus stress sweep) | 4,740 / 60.4 million | unchanged, by definition |
| the three new sweeps | - | 1,140 runs, 23,125,120 robot-steps, 0 executed conflicts, 0 illegal moves; 16 stalled runs (all `prioritysplit`, arm `blocking`) |
| guard | 240 text claims in 11 files, 10 summaries | 320 text claims in 11 files, 22 generated files, 13 summaries (as of review round 2; 313 after round 1) |
| tests | 58 | 68 |
| pages | 34 | 42 (as of review round 2; 41 after round 1) |

## 5. Timing

Quiet-host timing re-run at commit `6b64f93` (four attempts, the first invalid at load 1.73, three valid at 0.50, 0.49, 0.48).
`src/fms`, `scripts/bench-fms.ts` and `scripts/schema.ts` are identical at the commit of the results (`acbfe97`) and at `6b64f93`; the guard checks this with
git when the history is available. Epoch p50 / p99 / longest are in the paper (`tab:epoch`) and in `NUMBERS.md`. The static diagnostic matching and the counters
are timed apart (`diagMs`), so the planner times of the coupled methods no longer include them; the planner, scaling and ablation tables moved by at most 0.01 ms per tick at printed precision (raw maximum 0.0103, ablation `pact-h1`, 1.347 to 1.358).

## 6. Citations

- Added: Hönig et al. (2019), IEEE RA-L 4(2), 1125-1131, doi 10.1109/LRA.2019.2894217; Atzmon et al. (2020), JAIR 67, 549-579, doi 10.1613/jair.1.11734. Both checked against Crossref.
- MAPD-b (Bavaro and Amigoni, ECMR 2025, doi 10.1109/ECMR65884.2025.11163210) was already in the bibliography and cited; metadata checked.
- Zhang et al.: DOI 10.65109/mqik8423 added (checked against Crossref); key renamed `zhang2025flow` to `zhang2026flow`.
- `{Detour-Delta}` protected in the title; `standley2010finding` removed (never cited).
- `main.bbl` regenerated.

## 7. Cosmetic

`\label[appendix]` for the appendices (prints "appendix A"); CBS split by load; the abstract names the small layout for the CBS result;
the guard pointer in the introduction; wall time of the regeneration in the appendix; node expansions next to A* calls for TPTS;
running title, date and `CITATION.cff` / `README.md` follow the new title.

## 8. Wording and layout items of the ARIS update review (2026-11-14)

No number and no result changed. `npm run check:paper` passes with the same recomputed claims plus the triple-drain values.

- Repeated caveats merged: the abstract keeps the scope and the omitted full-trip and dock-queue costs; the equivalence-margin caveat is stated in section 4.2 and in the limitations only, and the introduction, the conclusion and sections 4.6 and 4.7 refer to them.
- The conclusion no longer ends its findings on the token-passing comparison (sentences reordered only).
- The introduction opens with the problem and the research question; the console description moved behind the introduction of the system.
- The abstract states that the proof needs a replanning period no longer than the window (`h <= w`).
- Proposition 3 states that the pairs priced by the large constant are discarded; the introduction says "optimal among the maximum feasible matchings".
- Notation: home bay `o^r` (was `h^r`), neighbours `\Gamma(v)` (was `N(v)`), planned robots of one call `n_p` (was `N`), held set `\mathcal{J}` with index `j` (was `\mathcal{K}`, `k`), pool size `q` (was `k`).
- Table 1 marks the best mean in bold only when no other method prints the same value; Figure 2 plots throughput and planner time in separate panels.
- "Triple drain" is defined in section 4.1, in the caption of the coupling table and in the parameter table (`drainMove` 0.003, `drainWait` 0.0006, read by the guard from `scripts/bench-fms.ts`).

## 9. Review round 1 of the v2 paper (`REVIEW_V2_RESPONSES.md`)

Findings of the first review of the v2 text. Findings judged wrong or only partly right are answered in `REVIEW_V2_RESPONSES.md`.
No committed result record changed. `paper/experiments/analysis/v2.json` gained `depletedRuns` per cell and a corrected `identicalToK6` (executed run only);
both are derived by `npm run analyze:v2` from the same records.

- Wording: the dock gate is a cause under batch load only; the scope of the null result names the dock-capacity gate and both arms (with and without event epochs); "greedy not worse in a regime where 10-26 % of the calls differ"; the abstract gives the bounds of the pre-registered result ("detect no difference (+0.4 ± 1.1 % and +0.6 ± 1.5 %)") and stays within 1,920 characters; "in two cells" for the K claims; "in every run of the default loop" for the normal-battery claims; "the second and third rounds measure all three"; the long-trips half-widths of the Discussion are service-time only; the epoch bound of the Discussion is scoped to the rows of `tab:epoch`.
- Reported next to results that were already in `NUMBERS.md`: depletions, undelivered tasks and holds per arm of the priority split (`tab:split`); the matching changes in calls with min(m, q) >= 2 (`tab:nondeg`); the executed-run difference from K = 6 (§4.3); the pre-registration deviations (§4.4, §4.7).
- Notation: pool size `q` (not `|P|`) in `min(m, q)`; the proxy path index is `i`; `tab:notation` has `m`, `n`, `n_p`, `\mathcal{X}`, `\mathcal{J}`, `\Gamma(v)`, `N_max`, `\mathcal{T}`, `\mathcal{T}^\star`; the seed row of `tab:params` reads "1-30 all other sweeps"; the appendix names the git checks of the guard; the captions of `tab:cascade` and `tab:epoch` are complete (column "Longest, max of repeats").
- Totals: guard 313 text claims, 41 pages, plain abstract 1,920 characters and 294 words; the stale timing entry of `NUMBERS.md` (0.77, 0.01992, 0.98053) is regenerated.
- Reproduction: `scripts/regenerate.sh` no longer overwrites an existing report (it writes a commit-stamped file or stops), so the history record `regeneration-schema2.json` that the paper cites is safe; the README names five wall-clock fields (`diagMs` added).
- Not changed: no counter of pending tasks per allocation call was added (it would change `src/fms` after the timing run and need a full regeneration), so the Poisson-load pool of one is stated as a mechanism without a number.

## 10. Review round 2 of the v2 paper (`REVIEW_V2_RESPONSES.md`, Round 2)

No committed result record and no number of an earlier statement changed. New numbers are recomputed by `npm run check:paper`.

- Discussion: the coupling-regime sentence gives throughput half-widths (1.0 to 1.6 %) next to the service-time half-widths, outside the long-trips regime (read from the same `pactSafe` set); the held-first sentence says "up to 3.0 % ... (resolved in three of the four settings)"; the mean-time sentences name their configurations and add the window-30 and period-1 planner times (2.0 and 1.4 ms per tick).
- Section 4.2: queueing time before assignment (3-4 ticks under the Poisson load against 220-252 under batch load; 0.4-0.5 pending tasks by Little's law) supports the Poisson-load mechanism; the share of greedy-Hungarian agreement is given on the static matrix of the Hungarian runs (90-98 %) and on DOCKET's matrix (91-99 %), and the introduction and the Discussion say "on DOCKET's cost matrix"; an allocation is defined as one call.
- Introduction: the contribution bullet carries the safety scope (synchronous unit-time execution, `h <= w`).
- Section 4.1 and 4.6: the timed sweeps include the timing-only sweep of `tab:epoch`; the stall detector is "more than 1000 ticks", the makespan tail is the 1,001 ticks from the last progress to the stop; the disclosure of the third round gives the 10 minutes between pre-registration and results; "hundreds to thousands of holds per run" for static priorities.
- Notation: the fleet `R` has no index set; `n_in` (input list of Algorithm 2) replaces `m` in Algorithm 2 and Proposition 1; the path step in its proof is `i`; `tab:notation` lists `n_in`.
- Captions: `tab:nondeg` second Changes column ("also the share of all calls in which the matching differs and the call has min(m, q) >= 2", for DOCKET and the proxy); `tab:split` ("more than 1000 ticks"); the planner figure says "reduces wait actions".
- Documentation: `NUMBERS.md` totals point to section 4 of this file; `PREREG_v2.md` Deviations 7 (append-only) says that entries 4 to 6 qualify entry 2; the duplicated phrase in section 3 of this file is removed; R1-5 of `REVIEW_V2_RESPONSES.md` is corrected.

