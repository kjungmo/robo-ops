/**
 * Schema of the benchmark records (paper/experiments/results/<sweep>.json).
 *
 * A change that adds fields to the records is a schema bump. It is made in
 * three steps, all in the commit that adds the fields:
 *   1. raise SCHEMA_VERSION;
 *   2. list the new fields in SCHEMA_ADDED under the new version;
 *   3. run scripts/regenerate.sh.
 *
 * scripts/check-results.ts --allow-new-fields (which regenerate.sh passes)
 * accepts a field that the committed records lack only if SCHEMA_ADDED lists
 * it for the current version. Any other new field, any missing field and any
 * changed value of an existing field is a difference, and regenerate.sh then
 * leaves the committed results untouched. bench-fms.ts writes the version
 * into bench-meta.json as `schemaVersion`.
 *
 * Version 1: the records of the paper before the deep review (commit 63a2db7,
 *   the cpl* counters and the audit fields included).
 * Version 2: allocation-shape counters (allocCalls, allocM1, allocPool1,
 *   allocNondegenerate, allocGreedyEqHungarian), cplAllocsMatchDifferNondegenerate,
 *   and diagMs, the wall-clock time of the counters, the static cost matrix
 *   and the static diagnostic matching. diagMs is a wall-clock field (see TIMING in check-results.ts).
 *   Since version 2, plannerMs and allocMs no longer contain the time of these
 *   diagnostics; they are timing fields, so no simulated quantity changes.
 */
export const SCHEMA_VERSION = 2

export const SCHEMA_ADDED: Record<number, readonly string[]> = {
  2: ['allocCalls', 'allocM1', 'allocPool1', 'allocNondegenerate', 'allocGreedyEqHungarian', 'cplAllocsMatchDifferNondegenerate'],
}
