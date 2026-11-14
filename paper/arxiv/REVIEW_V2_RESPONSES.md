# Responses to the review of the v2 paper

Each round lists the findings that were not applied as written, with the reason. Findings that were
applied are in `CHANGELOG_v2.md`, section 9. No text was left unchanged because a finding was wrong.
Three findings were met by a different fix than the one proposed; the reason is given for each.

## Round 1

Several reviewers sent the same finding more than once (the epoch bound, "a quarter or more", the
abstract wording, the stale changelog totals, the `k` index, the seed row). Each is answered once.

### R1-1. Pool of one task under the Poisson load (dock gate)

- **Finding.** The text blames the dock gate for the pool of one task in all 32-robot cells. Under
  the Poisson load the pool is small mostly because only one task is pending. The finding quotes a
  read-only measurement (59.6 % of the calls with one pending task in the warehouse, 57.3 % in the
  console) and offers two fixes: scope the gate to batch load, or add a counter and re-run.
- **Response.** Applied the scope fix; did not add the counter and did not use the measured
  numbers in the paper.
  - The abstract, the introduction, section 4.2 and the Discussion now name the gate as a cause
    under batch load (81-87 % of the calls with 32 robots) and say that under the Poisson load the
    pool is small largely because few tasks are pending.
  - The scope of the null result now reads "allocation under a dock-capacity gate", with event
    epochs in twelve cells and without them in two. "Binding" is dropped.
  - A counter for pending tasks per call would change `src/fms` after the timing run. The guard
    checks that the timing code and the results code are identical, so the timing would have to be
    repeated on a quiet host, and all 8,340 records would have to be regenerated.
  - The adjudicator's patched build is not a committed script. The rule is that every number in the
    paper comes from a committed script run, so the Poisson-load share is stated as a mechanism
    without a number, as the finding allows.

### R1-2. Share of calls with pool > K

- **Finding.** The pre-registration says the paper names the K cells "and the pool shares there".
  Add the share of calls with pool > K from a committed counter, or state that pairs per call
  stand in for it.
- **Response.** Applied the second option. The pool size is not a recorded counter. Adding it has
  the same cost as in R1-1. Section 4.3 now says that the share is not reported and that the priced
  pairs per call (3.4 / 6.6 / 8.9 and 4.1 / 6.0 / 7.1) are the evidence that K binds. The omission
  is recorded in `PREREG_v2.md`, Deviations 6.
- The sentence "the run of every seed differs from its run at K = 6" is replaced by a count that
  leaves the priced pairs out: all 30 seeds in three of the four comparisons, 16 of 30 at K = 12 in
  warehouse-8-batch. The count is computed in `scripts/analyze-v2.ts` and read by the guard.

### R1-3. Decision rule of E4 on `small-8`

- **Finding.** The implemented rule drops the clause "the other arm is not rejected". Either record a
  deviation or make the code follow the written rule.
- **Response.** Recorded the deviation (`PREREG_v2.md`, Deviations 4; section 4.4 of the paper;
  `CHANGELOG_v2.md`, section 3). The code and the computed numbers stay as committed, as the
  rules of this work require. The text says that the written rule gives no verdict on `small-8` and
  that the implementation returns "blocking-first accounts". The final attribution to the dynamic
  ordering as a whole does not change.

### R1-4. Secondary family of E2

- **Finding.** The family of 46 contrasts is not listed in the pre-registration.
- **Response.** Applied as proposed (Deviations 5; section 4.7 of the paper; changelog). The text also
  says that the one contrast that survives Holm is not among those the pre-registration lists.

### R1-5. Notation `n`

- **Finding.** `n` is missing from `tab:notation`.
- **Response.** Added, with the meaning that the text gives it in the statistics sentence (the
  number of seed pairs). `n` has no other use in the method section.

### R1-6. Pages and claim counts in `CHANGELOG_v2.md`

- **Finding.** 302 claims and 41 pages are stale.
- **Response.** Updated to the values of the final check of round 1 (see the changelog, section 4).
  The count of claims grew again in this round because new sentences have guard claims.
