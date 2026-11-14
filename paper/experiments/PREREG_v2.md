# Pre-registration of the v2 re-runs

Written and committed before any result of these experiments exists. The commit that adds this
file contains nothing else. The experiments answer the external deep review of 2026-10-29 as
judged in its adjudication (ruling section 4.2, items 2 to 5). Item 1 of the ruling (regenerate
all earlier sweeps with the new counters) is done and is not part of this file: it changed no
existing outcome.

What is fixed here: hypotheses, configurations, seeds, metrics, tests, decision rules, and the
labels that the results must carry. What is not fixed: the wording of the paper. Any deviation
found later is written into `Deviations` at the end of this file, with its commit, and is never
edited in place above.

## Conventions shared by all experiments

- **Seeds.** Seeds 1 to 30 in every sweep below. Runs with the same seed share the task stream and
  the initial charge, so every comparison is paired by seed (as in `scripts/paper-data.ts`).
- **Primary metric.** Throughput (tasks per 100 ticks, `throughput` in the records). Secondary
  metrics: `meanServiceTime`, `makespan`, `waitActions`, `tasksUnfinished`, `deadlocked`,
  executed conflicts (`audit_vertexConflicts + audit_swapConflicts`), and the allocation counters
  `allocCalls`, `allocNondegenerate`, `allocGreedyEqHungarian`, `cplAllocsMatchDiffer`,
  `cplAllocsMatchDifferNondegenerate`, `cplPairs`.
- **Effect size.** Mean per-seed relative difference in percent, `100 (x_a - x_b) / x_b`, with a
  two-sided 95 % Student-t interval over n = 30 pairs (29 degrees of freedom). This is the
  `paired()` function of `scripts/paper-data.ts`.
- **Test.** The two-sided paired t test on the same per-seed relative differences
  (`tTwoSidedP` of `scripts/stats.ts`). Multiplicity: Holm's step-down procedure at family-wise
  level 0.05 over the family named in each experiment. A comparison outside a named primary
  family is secondary: it is reported with its interval and its unadjusted p-value, and a
  secondary result that excludes zero is called nominal unless it also survives Holm over the
  secondary family of its experiment.
- **No equivalence claim.** An interval that contains zero is reported as "no difference
  detected, with these bounds". It is never reported as equivalence. The TOST re-run of the
  twelve main cells is out of the approved scope and is not run.
- **Safety check.** Every run is observed by the independent auditor, as in all sweeps. Every
  sweep below reports the number of executed conflicts, illegal moves, deadlocks and depletions.
  A non-zero count in a default-planner arm is reported in the paper, never dropped.
- **Records.** One new sweep per experiment, written by `scripts/bench-fms.ts` with `strict: false`
  and committed under `paper/experiments/results/`. They join `regenerate.sh` and the
  reproduction guard. The records of the ten earlier sweeps are not touched.
- **Counts.** Planned new runs: 1,140 in total (E2 720, E3 180, E4 240), listed per experiment. E5 adds timing runs that are not committed as records.

## E2. A regime in which the allocation is not degenerate (ruling 4.2-2)

**Origin, stated as such.** This configuration was chosen after the v1 ablation had shown a hint:
in the sweep `ablation` (warehouse, 32 robots, batch, 5 seeds), PACT without event-triggered
epochs against Hungarian without event-triggered epochs is **+3.32 +/- 2.97 %** in throughput
(n = 5, 4 degrees of freedom, nominal p = 0.036, not corrected for the fourteen comparisons of the
paired table). The matching changed in 23.2 % of the allocation calls without event epochs, and in
12.9 % with them. The experiment below is therefore **confirmatory of a post-hoc observation, not
blind**. The result is reported with this label. The ruling's counters show why a larger share of
the calls is a real assignment problem without event epochs (non-degenerate calls 18.9 % to 59.2 %
in warehouse-32-batch).

**Hypothesis H2.** With event-triggered epochs off, the coupled allocation (PACT) raises
throughput over Hungarian in a 32-robot batch cell. Direction expected from the hint: positive.
The test is two-sided.

**Configuration.** Sweep `nondegenerate`. Layouts and loads: `warehouse` and `console`, 32 robots,
batch (`arrivalRate: Infinity`), 200 tasks, PP planner, otherwise the defaults of `DEFAULT_CONFIG`
(dock capacity 3). Cost models: `greedy`, `hungarian`, `pact-proxy`, `pact`. Arms:

| Arm | Change from the defaults | Role |
|---|---|---|
| `noevent` | `eventReplan: false` | primary |
| `event` | none (`eventReplan: true`) | reference, same seeds, measures what the switch changes |
| `noevent-dock4` | `eventReplan: false`, `dockCapacity: 4` | optional arm: a looser dock gate |

Runs: 2 cells x 3 arms x 4 cost models x 30 seeds = 720. (The ruling's "about 240 runs" is the
`noevent` arm alone; the other two arms add 480 and are the reference and the optional arm.)
The `noevent` records of seeds 1 to 5 in the `warehouse-32-batch` cell must equal the
`pact-noEvent` and `hungarian-noEvent` records of the `ablation` sweep (same configuration): this
is checked and reported.

**Primary family (Holm, alpha = 0.05, 2 tests).**
- P2a: `noevent` arm, warehouse-32-batch, throughput of `pact` vs `hungarian`.
- P2b: `noevent` arm, console-32-batch, throughput of `pact` vs `hungarian`.

**Decision rule.**
- H2 is supported in a cell when its test is rejected by Holm and the mean is positive.
- If neither is rejected, the paper says: no throughput difference detected between PACT and
  Hungarian without event epochs, with the interval bounds; the null result then also holds in a
  regime where about half of the calls are real assignment problems, and the explanation of the
  null by degenerate calls alone is weakened.
- If a test is rejected with a negative mean, the paper reports PACT as worse in that cell.
- If H2 is supported in one cell only, the paper says so and does not generalise.

**Secondary (reported, none changes the decision above).**
- `noevent` arm: `pact-proxy` vs `hungarian`, `greedy` vs `hungarian`, `pact` vs `greedy`,
  throughput and service time, per cell. These test the claim "greedy is not measurably worse than
  optimal" where the share of non-degenerate calls is larger.
- Interaction: the per-seed difference between the relative effect of PACT vs Hungarian in
  `noevent` and in `event` (does switching the events off change the coupling's effect).
- `noevent-dock4` arm: the same contrasts as the primary family, exploratory; expected direction
  positive and no smaller than in `noevent` (more tasks pass the dock gate, so the pool is larger).
- Counters per arm: share of allocation calls with min(m, pool) >= 2, share of calls where greedy
  and Hungarian agree, matching changes of PACT in all calls and in non-degenerate calls.

## E3. Candidate count K in cells where the pool exceeds K (ruling 4.2-3)

**Hypothesis H3.** Where the task pool exceeds K in most allocation calls, the number of candidate
tasks priced per robot (K) changes the throughput of PACT. The v1 ablation ran in warehouse-32-batch,
where the pool is at most 3 in 99 % of the calls, so K could not bind there; the ruling gives the
pool as larger than 6 in 89 to 95 % of the calls of warehouse-8-batch and in 29.6 % of those of
narrow-16. The test is two-sided; no direction is assumed.

**Configuration.** Sweep `kablation`. `pact`, PP, batch, 200 tasks, event epochs on (defaults).
Cells: `warehouse-8-batch` (warehouse, 8 robots) and `narrow-16-batch` (narrow, 16 robots).
K in {3, 6, 12} (6 is the default). Runs: 2 cells x 3 K x 30 seeds = 180.

**Primary family (Holm, alpha = 0.05, 4 tests).** Per cell, throughput of K = 3 vs K = 6 and of
K = 12 vs K = 6.

**Decision rule.**
- K is said to matter in a cell when at least one of its two tests is rejected.
- If none of the four is rejected, the paper says: no effect of K detected in these cells, with the
  bounds, and the sentence naming K = 6 as a limit on what the cost sees is removed for all cells.
- Whatever the outcome, the paper names the cells in which K was varied and the pool shares there.
- The count of priced pairs (`cplPairs`) per allocation call is reported for every K, to show that
  the larger K prices more candidates (K cannot matter if it prices the same pairs).

## E4. Static priority split (ruling 4.2-4)

**Hypothesis H4.** The throughput advantage of the dynamic priority ordering over static
priorities, which the v1 text credits to "planning held robots first", comes from the held-first
rule. This tests it against the other two mechanisms that `priority: 'static'` switches off at the
same time: blocking-first ordering, and the admission of held parking robots to planning group 1.

**Arms.** Two new values of the `priority` option, added by the commit that adds the sweep, with the
defaults unchanged:
- `held`: held robots are planned first within a group, and held parking robots join group 1
  (the held-first mechanism with its two parts); the blocking-first ordering is off.
- `blocking`: robots that stand on another robot's goal are planned first within a group; the
  held-first ordering is off and held parking robots do not join group 1.

Both orderings fall back to status rank and then robot id, as `dynamic` and `static` do. The
reference arms are the records of the sweep `cascade` that already exist for the same settings and
seeds: `cascade` (full dynamic ordering, both mechanisms) and `static` (neither). They are not
re-run; the paired comparisons read them from `cascade.json`.

**Configuration.** Sweep `prioritysplit`. The four settings of the sweep `cascade`, copied
unchanged: `warehouse-32` (200 tasks), `warehouse-32-dock4` (200 tasks, dock capacity 4),
`small-8` (100 tasks), `narrow-16` (200 tasks). Hungarian, PP, batch, `fallback: 'cascade'`.
Runs: 4 settings x 2 arms x 30 seeds = 240.

**Primary family (Holm, alpha = 0.05, 8 tests).** Per setting, throughput of `held` vs `static`
and of `blocking` vs `static`.

**Secondary.** `held` vs `dynamic`, `blocking` vs `dynamic`, `dynamic` vs `static` (reference), per
setting; executed conflicts, deadlocks, unfinished tasks and hold events per arm.

**Decision rule (applied per setting where `dynamic` vs `static` excludes zero).**
- "Held-first accounts for the advantage" when `held` vs `static` is rejected with a positive mean
  and `held` vs `dynamic` contains zero, while `blocking` vs `static` is not rejected.
- "Blocking-first accounts for the advantage" is the same with the roles swapped.
- If both are rejected and each recovers the advantage (both contain zero against `dynamic`), the
  paper says that either mechanism suffices.
- If neither alone recovers it but `dynamic` vs `static` is positive, the paper says that the
  advantage needs the combination.
- If `dynamic` vs `static` contains zero in a setting, no attribution is made for that setting.
- The paper text names the mechanism(s) that the result supports. It no longer credits "held first"
  alone unless the first rule holds.

## E5. Timing and epoch latency on a quiet host (ruling 4.2-5)

**Procedure.** `scripts/measure-timing.sh` unchanged: three valid repeats of the sweeps `planner`,
`scaling`, `ablation` and the timing-only sweep `epochtime`, one process, with `FMS_EPOCH_TIMES=1`.
Admission rule: a repeat starts only when the one-minute load average is at most `LOAD_MAX`;
a repeat is invalid when the load average right after it exceeds `LOAD_MAX + 1.20`. The default
`LOAD_MAX` is 0.50. The ruling asks for a load below 1.0. If the host does not reach 0.50 within the
waiting time, the script is run with `LOAD_MAX=1.0`, and the value used is recorded with the result.
If neither is reached, the timing is not run and the paper keeps the earlier timings and says so.
The load average is checked with `uptime` before every attempt, and the attempts are logged.

**Reported.** Epoch wall time p50, p99 and maximum, and mean planner ms per tick, per configuration
(median and maximum over the valid repeats), for PP and CBS on warehouse-32 and narrow-16 and PP
with PACT on warehouse-32, and for the scaling and ablation configurations.
No decision rule: the numbers are descriptive.

## Not run, by design

- The TOST re-run of the twelve main cells at 30 seeds (1,440 runs): outside the approved scope.
- The IStay-style conflict-free fallback as a cascade reference: outside the approved scope.

## Deviations

Written after the results; each entry names what differs from the text above.

1. **E5, waiting time.** `measure-timing.sh` was run with `WAIT_S=1800` (the script's default is
   600) because the shared host rarely stayed below the admission load for ten minutes. The
   admission load stayed at the script's default `LOAD_MAX=0.50`; the fallback to 1.0 was not
   needed. Four attempts were made: attempt 1 was invalid (load average 1.73 right after it,
   above 0.50 + 1.20) and is kept in `paper/experiments/timing/`; attempts 2 to 4 were admitted
   at 0.50, 0.49 and 0.48 and are valid. The summary uses the three valid ones.
2. **E2, E3, E4: nothing differs.** Configurations, seeds, metrics, tests, families and decision
   rules are as written. The statistics are computed by `scripts/analyze-v2.ts`; the secondary
   families of E3 (Holm over 4) and E4 (Holm over 12) are the ones that the text above calls "the
   secondary family of its experiment".
3. **E4, reading of the decision rule.** The rule is applied mechanically by `analyze-v2.ts`
   (`e4.rules`). Its "recovers" test requires an interval against `dynamic` that contains zero.
   In warehouse-32 and warehouse-32-dock4 the interval of `held` vs `dynamic` excludes zero
   (about 2 to 3 % lower), so the rule returns "needs the combination" although `held` alone
   avoids the stalls that `static` has in every run. Both facts are reported; the rule's output
   is not changed.
4. **E4, a clause of the decision rule is not implemented.** Added in review round 1 of the
   paper (2026-11-14), after the results. The written rule credits one mechanism only if the
   *other* arm is not rejected against `static` ("while `blocking` vs `static` is not
   rejected", and the same with the roles swapped). `analyseE4` in `scripts/analyze-v2.ts`
   (`e4.rules`) drops that clause: it tests only that the arm is rejected against `static`
   with a positive mean and that its interval against `dynamic` contains zero. All eight
   primary comparisons are rejected, so no setting meets the dropped clause and the written
   rule never applies in the form "X accounts for the advantage". The omission changes one
   verdict. In `small-8` both single-mechanism arms are rejected against `static`, `blocking`
   recovers the dynamic ordering (-0.2 +/- 0.7 %) and `held` does not (-2.6 +/- 1.7 %). The
   written rules do not cover "both rejected, only one recovers", and the implementation
   returns "blocking-first accounts for the advantage". The other three verdicts are the
   same under the written rules (needs the combination, twice; either suffices). The code
   and the computed numbers are unchanged; the paper says that the implemented rule departs
   from the written one.
5. **E2, the secondary family.** Added in review round 1 of the paper (2026-11-14). The text
   above lists secondary contrasts for the `noevent` arm only (`pact-proxy`, `greedy` and
   `pact` against `greedy`, throughput and service time) and, for `noevent-dock4`, the
   contrasts of the primary family. It does not list the contrasts of the `event` arm or the
   other contrasts of the dock-4 arm. `analyze-v2.ts` puts the following contrasts into one
   secondary family, with Holm over all of it. Per cell and arm: `pact-proxy` vs `hungarian`,
   `greedy` vs `hungarian` and `pact` vs `greedy`, each for throughput and service time. For
   the `event` and `noevent-dock4` arms also `pact` vs `hungarian`, for both metrics, and for
   `noevent` also `pact` vs `hungarian` service time. That
   is 23 per cell and 46 in all. This family was fixed when the analysis was written, after
   the results existed. The one contrast that survives Holm in it (`pact` vs `greedy`
   service time, `noevent-dock4`, warehouse-32-batch, -1.2 +/- 0.6 %) is not among the
   contrasts that this file lists. The paper reports it as one secondary result of an
   optional arm and builds no claim on it.
6. **E3, pool shares not reported; one analysis definition changed.** Added in review round 1
   of the paper (2026-11-14). The decision rule says the paper names the cells and "the pool
   shares there". The share of calls whose pool exceeds K is not among the recorded counters
   (the pool size is not recorded), and adding it would change `src/fms` after the
   timing run. The paper therefore gives the priced pairs per call, which are the direct
   evidence that K binds, and says that the pool share is not reported. Separately, the first
   version of `identicalToK6` in `analyze-v2.ts` compared `cplPairs` among its fields. That
   field differs by construction whenever more candidates are priced, so every seed counted as
   different. The committed analysis now compares only the executed run (makespan, throughput,
   mean service time, move actions, wait actions): at K = 12 in warehouse-8-batch 14 of 30
   seeds are identical to K = 6, in every other comparison none is.
7. **Entry 2 is qualified by entries 4 to 6.** Added in review round 2 of the paper
   (2026-11-14). Entry 2 was written before review round 1 and says that nothing differs for
   E2, E3 and E4. Entries 4 (E4), 5 (E2) and 6 (E3) record differences in exactly these
   experiments, and they take precedence over entry 2. Entry 2 is not edited, as this file is
   append-only.
