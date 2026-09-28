/**
 * Battery model and threshold charging policy.
 *
 * State of charge (SoC) is a fraction in [0, 1]. A robot drains `drainMove`
 * per move action and `drainWait` per wait/idle tick, and gains `chargeRate`
 * per tick while docked at a charger slot. The policy is a two-threshold
 * hysteresis: a robot with SoC < socLow must charge before accepting work and
 * leaves the charger once SoC >= socHigh. Charger assignment (which free slot
 * a robot goes to) is solved as a min-cost assignment in the simulator so that
 * charger capacity (one robot per slot) is respected.
 */
export interface BatteryModel {
  readonly drainMove: number
  readonly drainWait: number
  readonly chargeRate: number
  readonly socLow: number
  readonly socHigh: number
  /** Safety margin kept when checking task feasibility. */
  readonly reserve: number
}

export const DEFAULT_BATTERY: BatteryModel = {
  drainMove: 0.001,
  drainWait: 0.0002,
  chargeRate: 0.005,
  socLow: 0.2,
  socHigh: 0.9,
  reserve: 0.05,
}

export function needsCharge(soc: number, model: BatteryModel): boolean {
  return soc < model.socLow
}

export function chargingDone(soc: number, model: BatteryModel): boolean {
  return soc >= model.socHigh
}

export function applyMove(soc: number, model: BatteryModel): number {
  return Math.max(0, soc - model.drainMove)
}

export function applyWait(soc: number, model: BatteryModel): number {
  return Math.max(0, soc - model.drainWait)
}

export function applyCharge(soc: number, model: BatteryModel): number {
  return Math.min(1, soc + model.chargeRate)
}
