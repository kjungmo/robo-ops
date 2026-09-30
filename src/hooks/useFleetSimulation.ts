import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FleetSimulator, type SimConfig, type SimSnapshot } from '../fms/sim/simulator'
import type { GridMap } from '../fms/map/grid'

export interface FleetSimulationControls {
  snapshot: SimSnapshot
  map: GridMap
  running: boolean
  speed: number
  config: Partial<SimConfig>
  play: () => void
  pause: () => void
  step: () => void
  reset: (config?: Partial<SimConfig>) => void
  setSpeed: (ticksPerSecond: number) => void
}

const DEFAULT_UI_CONFIG: Partial<SimConfig> = {
  layout: 'console',
  fleetSize: 12,
  numTasks: 120,
  arrivalRate: 0.25,
  alloc: 'pact',
  mapf: 'pp',
  seed: 7,
}

/**
 * Drives a {@link FleetSimulator} from React: a fixed-rate ticker advances the
 * simulation and republishes an immutable snapshot for rendering.
 */
export function useFleetSimulation(initial: Partial<SimConfig> = {}): FleetSimulationControls {
  const [config, setConfig] = useState<Partial<SimConfig>>({ ...DEFAULT_UI_CONFIG, ...initial })
  const [initialSim] = useState(() => new FleetSimulator({ ...DEFAULT_UI_CONFIG, ...initial }))
  const simRef = useRef<FleetSimulator>(initialSim)
  const [map, setMap] = useState<GridMap>(initialSim.map)
  const [snapshot, setSnapshot] = useState<SimSnapshot>(() => initialSim.snapshot())
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(10)

  const publish = useCallback(() => setSnapshot(simRef.current.snapshot()), [])

  const step = useCallback(() => {
    simRef.current.step()
    publish()
  }, [publish])

  const reset = useCallback(
    (next?: Partial<SimConfig>) => {
      const merged = { ...config, ...(next ?? {}) }
      setConfig(merged)
      const sim = new FleetSimulator(merged)
      simRef.current = sim
      setMap(sim.map)
      setRunning(false)
      setSnapshot(sim.snapshot())
    },
    [config],
  )

  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(() => {
      const sim = simRef.current
      if (sim.finished) {
        setRunning(false)
        return
      }
      sim.step()
      publish()
    }, Math.max(16, 1000 / speed))
    return () => window.clearInterval(interval)
  }, [running, speed, publish])

  return useMemo(
    () => ({
      snapshot,
      map,
      running,
      speed,
      config,
      play: () => setRunning(true),
      pause: () => setRunning(false),
      step,
      reset,
      setSpeed,
    }),
    [snapshot, map, running, speed, config, step, reset],
  )
}
