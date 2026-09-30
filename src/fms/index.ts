/**
 * Fleet Management System (FMS) algorithm module: framework-free TypeScript.
 *
 *   map/       grid model, ASCII loader, benchmark layouts
 *   alloc/     Hungarian and greedy assignment, cost models
 *   mapf/      space-time A*, reservation table, prioritized planning, CBS
 *   charging/  battery model and threshold charging policy
 *   sim/       discrete-time lifelong simulator, metrics and the independent
 *              trajectory auditor
 */
export { Rng } from './core/rng'
export * from './map/grid'
export * from './map/layouts'
export { hungarian, assignmentCost } from './alloc/hungarian'
export { greedyAssign } from './alloc/greedy'
export * from './alloc/cost'
export * from './mapf/constraints'
export { spaceTimeAStar, type PlanResult } from './mapf/spacetime_astar'
export * from './mapf/conflicts'
export { prioritizedPlan, type PPAgent, type PPResult, type PPFallback, type PPOptions } from './mapf/prioritized'
export { cbs, type CBSResult, type CBSOptions } from './mapf/cbs'
export { TokenTable, DwellGoal } from './mapf/token_table'
export * from './charging/policy'
export * from './sim/simulator'
export type { SimMetrics } from './sim/metrics'
export { TrajectoryAuditor, type AuditReport, type ObservedSim, type ObservedRobot } from './sim/audit'
