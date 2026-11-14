#!/usr/bin/env bash
# Regenerate every benchmark result at the current commit.
#
#   scripts/regenerate.sh [JOBS]        # JOBS worker processes, default 4
#   REGEN_REPORT=<file> scripts/regenerate.sh [JOBS]   # write the comparison there
#                                       # (default: paper/experiments/repro/regeneration-schema<N>.json)
#
# 1. Refuses to run on a dirty tree, so that the commit recorded in
#    bench-meta.json is the code that produced the records.
# 2. Runs all thirteen sweeps (the ten of v1 and the three v2 sweeps of
#    paper/experiments/PREREG_v2.md) into a temporary directory.
# 3. Compares the run with the committed records (scripts/check-results.ts):
#    every field that exists in both must be identical, wall-clock fields
#    excluded. New sweeps are listed, not counted. A new field is accepted only
#    if scripts/schema.ts lists it as added in the current SCHEMA_VERSION (an
#    explicit schema bump); any other new field counts as a difference. On any
#    difference the committed results are left untouched and the script fails.
# 4. Replaces paper/experiments/results/ with the run and writes the comparison
#    to paper/experiments/repro/regeneration-schema<SCHEMA_VERSION>.json. The
#    comparison of schema 1 (regeneration.json, commit 63a2db7) stays as it was.
#
# The records are deterministic given the seed, whatever JOBS is. Their
# wall-clock fields depend on the host and its load and are NOT the timings
# the paper reports; those come from scripts/measure-timing.sh.
#
# Duration on a 6-core Ryzen 5 5500GT: about 3 hours with JOBS=1, about
# 45 minutes with JOBS=4, about 25 minutes with JOBS=10 (estimates from the
# earlier runs plus the tpfree and v2 sweeps).
set -euo pipefail
JOBS="${1:-4}"
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "working tree has uncommitted changes; commit first" >&2
  exit 2
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "load average before: $(cat /proc/loadavg)"
npx tsx scripts/bench-fms.ts --jobs "$JOBS" --out "$TMP/run"
echo "load average after: $(cat /proc/loadavg)"
mkdir -p paper/experiments/repro
SCHEMA="$(sed -n 's/^export const SCHEMA_VERSION = \([0-9][0-9]*\)$/\1/p' scripts/schema.ts)"
REPORT="${REGEN_REPORT:-paper/experiments/repro/regeneration-schema${SCHEMA}.json}"
npx tsx scripts/check-results.ts "$TMP/run" --allow-new-fields --report "$REPORT"
# Reached only when no pre-existing field differs.
rm -f paper/experiments/results/*.json paper/experiments/results/*.csv
cp "$TMP/run"/*.json "$TMP/run"/*.csv paper/experiments/results/
rm -f paper/experiments/repro/repeat.json
echo "results replaced; now: npm run paper:data && npm run check:paper"
