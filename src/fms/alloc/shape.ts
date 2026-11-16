/**
 * Shape of one allocation call, for the counters in SimMetrics. Everything
 * here only reads its arguments: it never changes an assignment, never draws
 * from the random stream and never decides anything in the simulator.
 *
 * A call has m eligible robots and `pool` candidate tasks (after the dock and
 * pickup gate). It is degenerate when min(m, pool) < 2: one robot or one task
 * leaves no real assignment problem, because the solver only picks which robot
 * takes the single task (pool = 1) or which task the single robot takes (m = 1).
 */
export interface AllocShape {
  /** m = 1: a single eligible robot. */
  m1: boolean
  /** pool = 1: a single candidate task. */
  pool1: boolean
  /** min(m, pool) >= 2: a real assignment problem. */
  nondegenerate: boolean
}

export function allocShape(m: number, pool: number): AllocShape {
  return { m1: m === 1, pool1: pool === 1, nondegenerate: Math.min(m, pool) >= 2 }
}

/** True when two assignments (row -> column or -1) are identical. */
export function sameAssignment(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((j, i) => j === b[i])
}
