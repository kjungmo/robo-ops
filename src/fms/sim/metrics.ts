/** Metrics emitted by one simulation run. */
export interface SimMetrics {
  layout: string
  fleetSize: number
  numTasks: number
  arrivalRate: number
  seed: number
  alloc: string
  mapf: string
  window: number
  period: number
  wBattery: number
  /** Ticks until the last task was delivered (or maxTicks if unfinished). */
  makespan: number
  tasksCompleted: number
  tasksUnfinished: number
  /** 1 if the run was aborted by the stall detector (no task progress). */
  deadlocked: number
  /** Completed tasks per 100 ticks. */
  throughput: number
  /** Mean (delivery - arrival) over completed tasks. */
  meanServiceTime: number
  /** Mean (first assignment - arrival). */
  meanWaitTime: number
  /** Mean (delivery - assignment). */
  meanExecTime: number
  /** Sum over completed tasks of (delivery - assignment). */
  sumOfCosts: number
  moveActions: number
  waitActions: number
  conflicts: number
  depletionEvents: number
  chargeSessions: number
  holdEvents: number
  cbsFallbacks: number
  /** CBS fallbacks caused by the node budget (the rest: a robot without any path). */
  cbsBudgetExceeded: number
  /** Token passing with task swaps: tasks taken over from another robot. */
  taskSwaps: number
  /** Token passing: searches cut off by the expansion bound. */
  tpSearchLimitHits: number
  /** Token passing with task swaps: earlier-arriving swaps dropped because the displaced robot had no path home. */
  tpSwapVetoes: number
  epochs: number
  astarCalls: number
  expansions: number
  /** Wall-clock ms spent in allocation + planning. */
  plannerMs: number
  allocMs: number
  /** Planner ms per simulated tick. */
  plannerMsPerTick: number
  /** Fraction of robot-ticks spent with an active task. */
  utilization: number
  /** Mean SoC over robots at the end of the run. */
  finalMeanSoc: number
}
