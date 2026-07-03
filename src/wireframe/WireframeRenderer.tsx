import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from './AppShell'
import { childStyle, columnClassName, imageClassName, isCenteredAuthPage, layoutStyle, rowClassName } from './layoutUtils'
import type { WireframeAction, WireframeNode, WireframePage } from './types'
import './wireframe.css'

type RendererContext = {
  nodes: Record<string, WireframeNode>
  onAction: (action?: WireframeAction) => void
}

type NodeTreeProps = {
  nodeId: string
  parent: WireframeNode | null
  ctx: RendererContext
}

function NodeTree({ nodeId, parent, ctx }: NodeTreeProps) {
  const node = ctx.nodes[nodeId]
  if (!node) return null

  const slotStyle = childStyle(parent, node, ctx.nodes)
  const children = node.childrenIds.map((childId) => (
    <NodeTree key={childId} nodeId={childId} parent={node} ctx={ctx} />
  ))

  const wrap = (className: string, content: React.ReactNode, style?: CSSProperties, extra?: object) => (
    <div className={className} style={{ ...slotStyle, ...style }} {...extra}>
      {content}
    </div>
  )

  switch (node.type) {
    case 'page':
      return <>{children}</>

    case 'body':
      return wrap('mf-page-body', children)

    case 'row':
      return wrap(rowClassName(node, ctx.nodes), children, layoutStyle(node.layout))

    case 'column':
      return wrap(columnClassName(node), children, layoutStyle(node.layout))

    case 'box': {
      const classes = ['mf-box']
      if (node.attributes?.outlined !== undefined) classes.push('mf-box--outlined')
      if (node.action) classes.push('mf-box--clickable')

      const interactive = node.action
        ? {
            role: 'button' as const,
            tabIndex: 0,
            onClick: () => ctx.onAction(node.action),
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                ctx.onAction(node.action)
              }
            },
          }
        : {}

      return wrap(classes.join(' '), children, layoutStyle(node.layout), interactive)
    }

    case 'text': {
      if (!node.label?.trim()) return null
      return (
        <p className={`mf-text mf-text--${node.size ?? 'base'}`} style={slotStyle}>
          {node.label}
        </p>
      )
    }

    case 'button': {
      const classes = ['mf-btn']
      if (node.variant === 'primary') classes.push('mf-btn--primary')
      else if (node.variant === 'danger') classes.push('mf-btn--danger')
      else if (node.variant === 'chip') {
        classes.push('mf-btn--chip')
        if (node.activeIndex === 0) classes.push('is-active')
      } else {
        classes.push('mf-btn--secondary')
      }

      return (
        <button
          type="button"
          className={classes.join(' ')}
          style={slotStyle}
          onClick={() => ctx.onAction(node.action)}
        >
          {node.label}
        </button>
      )
    }

    case 'input':
      return (
        <div className="mf-field" style={slotStyle}>
          {node.inputType === 'search' ? (
            <input
              id={node.id}
              type="search"
              placeholder={node.label ?? '검색'}
              readOnly
              className="mf-input mf-input--search"
            />
          ) : node.inputType === 'area' ? (
            <>
              {node.label ? <label htmlFor={node.id}>{node.label}</label> : null}
              <textarea id={node.id} readOnly className="mf-input mf-input--area" rows={4} />
            </>
          ) : node.inputType === 'check' ? (
            <label className="mf-check" htmlFor={node.id}>
              <input id={node.id} type="checkbox" readOnly />
              <span>{node.label}</span>
            </label>
          ) : node.inputType === 'select' ? (
            <>
              {node.label ? <label htmlFor={node.id}>{node.label}</label> : null}
              <select id={node.id} className="mf-input mf-input--select" defaultValue="">
                {(node.attributes?.options ?? '')
                  .split(',')
                  .map((option) => option.trim())
                  .filter(Boolean)
                  .map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
              </select>
            </>
          ) : node.inputType === 'toggle' ? (
            <label className="mf-toggle" htmlFor={node.id}>
              <span>{node.label}</span>
              <span
                className={`mf-toggle__track${node.attributes?.on !== undefined ? ' is-on' : ''}`}
                aria-hidden="true"
              >
                <span className="mf-toggle__thumb" />
              </span>
            </label>
          ) : (
            <>
              {node.label ? <label htmlFor={node.id}>{node.label}</label> : null}
              <input id={node.id} type="text" placeholder={node.label} readOnly className="mf-input" />
            </>
          )}
        </div>
      )

    case 'spacer':
      return <div className="mf-spacer" style={slotStyle} aria-hidden="true" />

    case 'image': {
      const size = node.imageSize ?? 48
      const className = imageClassName(node, parent)
      return (
        <div
          className={className}
          style={{
            ...slotStyle,
            ...(node.imageRound
              ? { width: size, height: size }
              : layoutStyle(node.layout)),
          }}
          title={node.label}
        >
          {node.imageRound ? (node.label?.charAt(0) ?? '•') : node.label ?? 'Image'}
        </div>
      )
    }

    case 'table': {
      const headers = (node.label ?? '').split(',').map((h) => h.trim()).filter(Boolean)
      const rows = node.listRows ?? 3

      return (
        <div className="mf-table-wrap" style={slotStyle}>
          <table className="mf-table">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((header) => (
                    <td key={`${rowIndex}-${header}`}>—</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    default:
      return wrap('mf-box mf-box--outlined', (
        <>
          {node.label ? <p className="mf-text mf-text--sm">{node.label}</p> : null}
          {children}
        </>
      ))
  }
}

function OverlayPanel({
  node,
  ctx,
  onClose,
}: {
  node: WireframeNode
  ctx: RendererContext
  onClose: () => void
}) {
  const overlayCtx: RendererContext = {
    nodes: ctx.nodes,
    onAction: (action) => {
      if (!action || action.type === 'close') {
        onClose()
        return
      }
      ctx.onAction(action)
    },
  }

  return (
    <div className="mf-overlay-backdrop" onClick={onClose}>
      <div
        className="mf-overlay"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        {node.childrenIds.map((childId) => (
          <NodeTree key={childId} nodeId={childId} parent={node} ctx={overlayCtx} />
        ))}
      </div>
    </div>
  )
}

export function WireframeRenderer({ page }: { page: WireframePage }) {
  const navigate = useNavigate()
  const [openOverlayId, setOpenOverlayId] = useState<string | null>(null)

  const root = page.nodes[page.rootId]

  const { bodyId, overlays } = useMemo(() => {
    const bodyChild = root?.childrenIds.find((id) => page.nodes[id]?.type === 'body')
    const overlayChildren =
      root?.childrenIds.filter((id) => page.nodes[id]?.type === 'overlay') ?? []

    return {
      bodyId: bodyChild,
      overlays: overlayChildren.map((id) => page.nodes[id]).filter(Boolean),
    }
  }, [page.nodes, root])

  const onAction = useCallback(
    (action?: WireframeAction) => {
      if (!action) return

      if (action.type === 'navigate') {
        setOpenOverlayId(null)
        navigate(`/page/${action.targetPageNodeId}`)
        return
      }

      if (action.type === 'open-modal') {
        setOpenOverlayId(action.targetOverlayId)
        return
      }

      if (action.type === 'close') {
        setOpenOverlayId(null)
      }
    },
    [navigate],
  )

  const ctx: RendererContext = { nodes: page.nodes, onAction }
  const activeOverlay = overlays.find((overlay) => overlay.overlayId === openOverlayId)
  const centered = isCenteredAuthPage(page.pageNodeId)

  return (
    <AppShell pageName={page.pageName}>
      <div className={centered ? 'mf-screen mf-screen--centered' : 'mf-screen'}>
        {bodyId ? <NodeTree nodeId={bodyId} parent={null} ctx={ctx} /> : null}
      </div>

      {activeOverlay ? (
        <OverlayPanel
          node={activeOverlay}
          ctx={ctx}
          onClose={() => setOpenOverlayId(null)}
        />
      ) : null}
    </AppShell>
  )
}
