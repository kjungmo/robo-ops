import { useEffect, useRef } from 'react'
import { AppShell } from '../wireframe/AppShell'
import { useFleetSimulation } from '../hooks/useFleetSimulation'
import { chargerSlots, type GridMap } from '../fms/map/grid'
import type { RobotStatus, SimSnapshot } from '../fms/sim/simulator'
import '../wireframe/wireframe.css'
import './fms.css'

/** Korean status labels matching the console's robot screens. */
const STATUS_LABEL: Record<RobotStatus, string> = {
  idle: '대기 중',
  to_pickup: '이동 중',
  loading: '작업 중',
  to_delivery: '운반 중',
  unloading: '작업 중',
  to_charger: '충전소 이동',
  charging: '충전 중',
  parking: '복귀 중',
  depleted: '오프라인',
}

const STATUS_CLASS: Record<RobotStatus, string> = {
  idle: 'is-idle',
  to_pickup: 'is-moving',
  loading: 'is-working',
  to_delivery: 'is-moving',
  unloading: 'is-working',
  to_charger: 'is-charging',
  charging: 'is-charging',
  parking: 'is-idle',
  depleted: 'is-offline',
}

const CELL = 18

function drawMap(canvas: HTMLCanvasElement, map: GridMap, snap: SimSnapshot) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = map.width * CELL
  canvas.height = map.height * CELL
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const pickups = new Set(map.pickups)
  const docks = new Set(map.deliveries)
  const homes = new Set(map.homes)
  const chargers = new Set(chargerSlots(map))
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const c = y * map.width + x
      let fill = '#ffffff'
      if (map.blocked[c]) fill = '#cbd5e1'
      else if (pickups.has(c)) fill = '#fef3c7'
      else if (docks.has(c)) fill = '#dcfce7'
      else if (chargers.has(c)) fill = '#dbeafe'
      else if (homes.has(c)) fill = '#f1f5f9'
      ctx.fillStyle = fill
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1)
    }
  }
  ctx.lineWidth = 2
  for (const r of snap.robots) {
    if (r.path.length > 1) {
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)'
      ctx.beginPath()
      ctx.moveTo(r.path[0][0] * CELL + CELL / 2, r.path[0][1] * CELL + CELL / 2)
      for (const [px, py] of r.path.slice(1)) ctx.lineTo(px * CELL + CELL / 2, py * CELL + CELL / 2)
      ctx.stroke()
    }
  }
  for (const r of snap.robots) {
    const cx = r.x * CELL + CELL / 2
    const cy = r.y * CELL + CELL / 2
    const color =
      r.status === 'depleted'
        ? '#6b7280'
        : r.status === 'charging' || r.status === 'to_charger'
          ? '#2563eb'
          : r.soc < 0.2
            ? '#dc2626'
            : r.task
              ? '#16a34a'
              : '#f59e0b'
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, CELL * 0.38, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 8px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(r.id + 1), cx, cy)
  }
}

export function FmsSimulatorPage() {
  const sim = useFleetSimulation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { snapshot, map } = sim

  useEffect(() => {
    if (canvasRef.current) drawMap(canvasRef.current, map, snapshot)
  }, [map, snapshot])

  const total = snapshot.robots.length
  const pct = (n: number) => (total === 0 ? '0%' : `${Math.round((100 * n) / total)}%`)

  return (
    <AppShell pageName="FMS 시뮬레이터">
      <div className="fms">
        <div className="fms__toolbar">
          <label>
            레이아웃
            <select
              value={sim.config.layout}
              onChange={(e) => sim.reset({ layout: e.target.value, fleetSize: Math.min(sim.config.fleetSize ?? 8, e.target.value === 'small' ? 8 : 32) })}
            >
              <option value="small">small</option>
              <option value="warehouse">warehouse</option>
              <option value="console">console (구역 A–D)</option>
            </select>
          </label>
          <label>
            로봇 수
            <input
              type="number"
              min={1}
              max={sim.config.layout === 'small' ? 8 : sim.config.layout === 'console' ? 32 : 48}
              value={sim.config.fleetSize}
              onChange={(e) => sim.reset({ fleetSize: Number(e.target.value) })}
            />
          </label>
          <label>
            할당 방식
            <select value={sim.config.alloc} onChange={(e) => sim.reset({ alloc: e.target.value as never })}>
              <option value="greedy">greedy</option>
              <option value="hungarian">hungarian</option>
              <option value="pact-proxy">pact-proxy</option>
              <option value="pact">pact</option>
            </select>
          </label>
          <label>
            경로 계획
            <select value={sim.config.mapf} onChange={(e) => sim.reset({ mapf: e.target.value as never })}>
              <option value="pp">prioritized</option>
              <option value="cbs">windowed CBS</option>
            </select>
          </label>
          <label>
            속도 (tick/s)
            <input type="range" min={1} max={40} value={sim.speed} onChange={(e) => sim.setSpeed(Number(e.target.value))} />
          </label>
          <div className="fms__buttons">
            {sim.running ? (
              <button type="button" className="mf-btn mf-btn--secondary" onClick={sim.pause}>
                일시정지
              </button>
            ) : (
              <button type="button" className="mf-btn mf-btn--primary" onClick={sim.play} disabled={snapshot.finished}>
                실행
              </button>
            )}
            <button type="button" className="mf-btn mf-btn--secondary" onClick={sim.step} disabled={snapshot.finished}>
              1 tick
            </button>
            <button type="button" className="mf-btn mf-btn--secondary" onClick={() => sim.reset()}>
              초기화
            </button>
          </div>
        </div>

        <div className="fms__kpis">
          <div className="fms__kpi">
            <span>전체 로봇</span>
            <strong>{total}</strong>
          </div>
          <div className="fms__kpi">
            <span>이동 중</span>
            <strong>{snapshot.movingRobots}</strong>
            <em>{pct(snapshot.movingRobots)}</em>
          </div>
          <div className="fms__kpi">
            <span>대기 중</span>
            <strong>{snapshot.idleRobots}</strong>
            <em>{pct(snapshot.idleRobots)}</em>
          </div>
          <div className="fms__kpi">
            <span>충전 중</span>
            <strong>{snapshot.chargingRobots}</strong>
            <em>{pct(snapshot.chargingRobots)}</em>
          </div>
          <div className="fms__kpi">
            <span>임무 완료</span>
            <strong>{snapshot.completedTasks}</strong>
            <em>/ {snapshot.totalTasks} (대기 {snapshot.pendingTasks})</em>
          </div>
          <div className="fms__kpi">
            <span>tick</span>
            <strong>{snapshot.tick}</strong>
            <em>충돌 {snapshot.conflicts} · 방전 {snapshot.depletionEvents}</em>
          </div>
        </div>

        <div className="fms__body">
          <div className="fms__map">
            <canvas ref={canvasRef} />
            <div className="fms__legend">
              <span className="fms__swatch" style={{ background: '#fef3c7' }} /> 피킹 지점
              <span className="fms__swatch" style={{ background: '#dcfce7' }} /> 출하 도크
              <span className="fms__swatch" style={{ background: '#dbeafe' }} /> 충전소
              <span className="fms__swatch" style={{ background: '#f1f5f9' }} /> 대기 구역
              <span className="fms__swatch" style={{ background: '#cbd5e1' }} /> 선반·장애물
            </div>
          </div>
          <div className="mf-table-wrap fms__table">
            <table className="mf-table">
              <thead>
                <tr>
                  <th>로봇</th>
                  <th>상태</th>
                  <th>배터리</th>
                  <th>미션</th>
                  <th>위치</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.robots.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>
                      <span className={`fms__status ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td>{Math.round(r.soc * 100)}%</td>
                    <td>{r.task ?? '—'}</td>
                    <td>
                      x: {r.x} / y: {r.y}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="fms__note">
          시뮬레이션 데이터입니다 — src/fms 의 할당·경로계획·충전 알고리즘을 브라우저에서 실행한 결과이며 실제 로봇 텔레메트리가 아닙니다.
        </p>
      </div>
    </AppShell>
  )
}
