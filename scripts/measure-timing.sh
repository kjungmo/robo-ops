#!/usr/bin/env bash
# Measure the wall-clock numbers the paper reports, on a quiet host.
#
#   scripts/measure-timing.sh            # 3 valid repeats, at most 6 attempts
#
# What it measures: planner milliseconds per simulated tick of the planner,
# scaling and ablation sweeps (160 runs per repeat), single process (--jobs 1).
# These are the only sweeps whose wall-clock fields the paper quotes (planner
# table, ablation table, scaling table and figure, window figure).
#
# Admission rule, fixed before any run:
#   - a repeat starts only when the 1-minute load average is at most LOAD_MAX
#     (default 0.50); otherwise the script waits up to WAIT_S seconds and then
#     gives up;
#   - a repeat is INVALID when the 1-minute load average right after it exceeds
#     LOAD_MAX + 1.20 (the benchmark itself contributes about 1.0).
# Invalid repeats are kept and reported, never dropped silently; the summary
# uses the valid ones and needs at least REPEATS of them.
# Why 0.50: the runs are single-threaded on a 6-core CPU. With at most half a
# runnable foreign thread on average the benchmark keeps a physical core to
# itself. Under a load average of 6 to 15 the same sweeps took 1.5 to 6 times
# as long, so a loaded measurement says nothing about the planner.
#
# Output (paper/experiments/timing/):
#   repeat-<n>.csv   one line per run: the four wall-clock fields
#   host-<n>.txt     /proc/loadavg, core count and the top CPU consumers
#                    before and after repeat n
#   summary.json     per configuration: seed-mean planner ms/tick of every
#                    repeat, and the median, minimum and maximum over the
#                    valid repeats; written by scripts/timing-summary.ts
# One quiet repeat takes about 80 to 90 seconds; three take about 5 minutes.
set -euo pipefail
REPEATS="${REPEATS:-3}"
ATTEMPTS="${ATTEMPTS:-6}"
LOAD_MAX="${LOAD_MAX:-0.50}"
WAIT_S="${WAIT_S:-600}"
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "working tree has uncommitted changes; commit first" >&2
  exit 2
fi
OUT=paper/experiments/timing
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
rm -f "$OUT"/repeat-*.csv "$OUT"/host-*.txt "$OUT"/summary.json

load1() { cut -d' ' -f1 /proc/loadavg; }
snapshot() {
  echo "date: $(date -Is)"
  echo "loadavg: $(cat /proc/loadavg)"
  echo "cores: $(nproc)"
  echo "top CPU consumers (%cpu command):"
  ps -eo pcpu,comm --sort=-pcpu | sed -n '2,7p'
}
admit() {
  local waited=0
  while awk -v l="$(load1)" -v m="$LOAD_MAX" 'BEGIN { exit !(l > m) }'; do
    if [ "$waited" -ge "$WAIT_S" ]; then
      echo "1-minute load average $(load1) stays above $LOAD_MAX; not measuring" >&2
      return 1
    fi
    sleep 15
    waited=$((waited + 15))
  done
}

valid=0
n=0
while [ "$valid" -lt "$REPEATS" ] && [ "$n" -lt "$ATTEMPTS" ]; do
  n=$((n + 1))
  admit
  { echo "== before repeat $n"; snapshot; } > "$OUT/host-$n.txt"
  npx tsx scripts/bench-fms.ts planner scaling ablation --out "$TMP/repeat-$n" > "$TMP/bench-$n.log"
  { echo "== after repeat $n"; snapshot; } >> "$OUT/host-$n.txt"
  if awk -v l="$(load1)" -v m="$LOAD_MAX" 'BEGIN { exit !(l > m + 1.20) }'; then
    echo "verdict: INVALID (1-minute load average after the repeat above $LOAD_MAX + 1.20)" >> "$OUT/host-$n.txt"
    echo "repeat $n: INVALID, load $(load1)"
  else
    echo "verdict: valid" >> "$OUT/host-$n.txt"
    valid=$((valid + 1))
    echo "repeat $n: valid, load $(load1)"
  fi
  # The simulated quantities must be the committed ones; only the clock may differ.
  npx tsx scripts/check-results.ts "$TMP/repeat-$n" > "$TMP/check-$n.log" || { cat "$TMP/check-$n.log"; exit 1; }
done
npx tsx scripts/timing-summary.ts "$TMP" "$OUT" "$n" "$LOAD_MAX"
if [ "$valid" -lt "$REPEATS" ]; then
  echo "only $valid valid repeats of $REPEATS after $n attempts" >&2
  exit 1
fi
echo "timing written to $OUT; now: npm run paper:data && npm run check:paper"
