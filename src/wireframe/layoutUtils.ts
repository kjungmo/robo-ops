import type { CSSProperties } from 'react'
import type { WireframeLayout, WireframeNode } from './types'

const ALIGN: Record<string, CSSProperties['alignItems']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
}

const JUSTIFY: Record<string, CSSProperties['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
}

export function layoutStyle(layout?: WireframeLayout): CSSProperties {
  if (!layout) return {}

  const style: CSSProperties = {}
  if (layout.gap != null) style.gap = layout.gap
  if (layout.width != null) {
    style.width = layout.width
    style.maxWidth = '100%'
  }
  if (layout.height != null) style.height = layout.height
  if (layout.align) style.alignItems = ALIGN[layout.align]
  if (layout.justify) style.justifyContent = JUSTIFY[layout.justify]
  return style
}

function rowSiblings(parent: WireframeNode, nodes: Record<string, WireframeNode>) {
  return parent.childrenIds.map((id) => nodes[id]).filter(Boolean)
}

/** n37-style: column | status text | button */
function isVersionListRow(siblings: WireframeNode[]) {
  if (siblings.some((s) => s.type === 'spacer' || s.type === 'image' || s.type === 'row')) {
    return false
  }
  const hasColumn = siblings.some((s) => s.type === 'column')
  const hasButton = siblings.some((s) => s.type === 'button')
  const textCount = siblings.filter((s) => s.type === 'text').length
  return hasColumn && hasButton && textCount >= 1
}

/** n44-style: column | role | status | action-row */
function isRecordRow(siblings: WireframeNode[]) {
  if (siblings.some((s) => s.type === 'spacer' || s.type === 'image')) return false
  const hasColumn = siblings.some((s) => s.type === 'column')
  const textCount = siblings.filter((s) => s.type === 'text').length
  const hasNestedRow = siblings.some((s) => s.type === 'row')
  return hasColumn && textCount >= 2 && hasNestedRow
}

/** n34-style: column | action-row */
function isSplitRow(siblings: WireframeNode[]) {
  if (siblings.some((s) => s.type === 'spacer' || s.type === 'image')) return false
  const columns = siblings.filter((s) => s.type === 'column')
  const rest = siblings.filter((s) => s.type !== 'column' && s.type !== 'spacer')
  return columns.length === 1 && rest.length === 1 && rest[0].type === 'row'
}

function isMediaRow(siblings: WireframeNode[]) {
  return siblings.some((s) => s.type === 'image') && siblings.some((s) => s.type === 'column')
}

function isStatBoxRow(siblings: WireframeNode[]) {
  return siblings.length >= 3 && siblings.every((s) => s.type === 'box')
}

function isFilterRow(siblings: WireframeNode[]) {
  return (
    siblings.some((s) => s.type === 'input' && s.inputType === 'search') &&
    siblings.some((s) => s.type === 'button')
  )
}

/** n37-style: column | spacer | column | button-row */
function isToolbarRow(siblings: WireframeNode[]) {
  return (
    siblings.some((s) => s.type === 'spacer') &&
    siblings.some((s) => s.type === 'column') &&
    siblings.some((s) => s.type === 'row')
  )
}

function isHeaderRow(siblings: WireframeNode[]) {
  return (
    siblings.length === 2 &&
    siblings.some((s) => s.type === 'text') &&
    siblings.some((s) => s.type === 'button')
  )
}

/** label | value rows (site cards, detail fields) */
function isKvRow(node: WireframeNode, siblings: WireframeNode[]) {
  return (
    siblings.length === 2 &&
    siblings.every((s) => s.type === 'text') &&
    node.layout?.justify === 'between'
  )
}

/** status label + action buttons in a card */
function isActionRow(siblings: WireframeNode[]) {
  if (!siblings.some((s) => s.type === 'button')) return false
  return siblings.every((s) => s.type === 'text' || s.type === 'button')
}

function firstTrailingIndex(siblings: WireframeNode[]) {
  return siblings.findIndex((s) => s.type !== 'column' && s.type !== 'spacer')
}

export function rowClassName(node: WireframeNode, nodes: Record<string, WireframeNode>) {
  const siblings = rowSiblings(node, nodes)
  const classes = ['mf-row']
  if (node.layout?.align === 'stretch') classes.push('mf-row--stretch')
  if (isMediaRow(siblings)) classes.push('mf-row--media')
  if (isStatBoxRow(siblings)) classes.push('mf-row--stat')
  if (isToolbarRow(siblings)) classes.push('mf-row--toolbar')
  if (isHeaderRow(siblings)) classes.push('mf-row--header')
  if (isKvRow(node, siblings)) classes.push('mf-row--kv')
  if (isRecordRow(siblings)) classes.push('mf-row--record')
  if (isSplitRow(siblings)) classes.push('mf-row--split')
  if (isActionRow(siblings)) classes.push('mf-row--actions')
  if (isFilterRow(siblings)) classes.push('mf-row--filter')
  return classes.join(' ')
}

export function columnClassName(node: WireframeNode) {
  const classes = ['mf-col']
  if (node.layout?.width != null) classes.push('mf-col--fixed')
  if (node.layout?.align === 'center') classes.push('mf-col--center')
  if (node.layout?.align === 'end') classes.push('mf-col--end')
  return classes.join(' ')
}

export function imageClassName(node: WireframeNode, parent: WireframeNode | null) {
  if (node.imageRound) return 'mf-avatar'
  if (parent?.type === 'row') return 'mf-image mf-image--thumb'
  return 'mf-image'
}

export function childStyle(
  parent: WireframeNode | null,
  node: WireframeNode,
  nodes: Record<string, WireframeNode>,
): CSSProperties {
  if (!parent) return {}

  const style: CSSProperties = {}

  if (node.type === 'spacer') {
    style.flex = '1 1 auto'
    style.minWidth = 8
    return style
  }

  if (parent.type !== 'row') return style

  const siblings = rowSiblings(parent, nodes)
  const hasSpacer = siblings.some((s) => s.type === 'spacer')
  const allBoxes = siblings.every((s) => s.type === 'box' || s.type === 'spacer')
  const allColumns = siblings.length > 0 && siblings.every((s) => s.type === 'column')

  if (node.type === 'box' && isStatBoxRow(siblings)) {
    style.flex = '1 1 0'
    style.minWidth = 64
    return style
  }

  if (node.type === 'box' && allBoxes) {
    style.flex = '1 1 0'
    style.minWidth = 0
    return style
  }

  if (node.type === 'column' && allColumns) {
    if (node.layout?.width != null) {
      style.flex = `0 0 ${node.layout.width}px`
      style.width = node.layout.width
      style.maxWidth = '100%'
    } else {
      style.flex = '1 1 0'
      style.minWidth = 0
    }
    return style
  }

  if (isMediaRow(siblings)) {
    if (node.type === 'image' && !node.imageRound) {
      const thumb = node.layout?.height ?? 96
      style.flex = '0 0 auto'
      style.flexShrink = 0
      style.width = Math.round(thumb * 1.25)
      style.minWidth = Math.round(thumb * 1.25)
      return style
    }
    if (node.type === 'column') {
      style.flex = '1 1 0'
      style.minWidth = 0
      return style
    }
  }

  if (isToolbarRow(siblings)) {
    const columns = siblings.filter((s) => s.type === 'column')
    if (node.type === 'column' && node.id === columns[0]?.id) {
      style.flex = '1 1 200px'
      style.minWidth = 0
      return style
    }
    if (node.type === 'column') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
      return style
    }
    if (node.type === 'row') {
      style.flex = '1 1 260px'
      style.flexShrink = 0
      style.marginLeft = 'auto'
      return style
    }
    return style
  }

  if (hasSpacer) {
    if (node.type === 'column' || node.type === 'row' || node.type === 'button' || node.type === 'text') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
    }
    return style
  }

  if (isFilterRow(siblings)) {
    if (node.type === 'input') {
      style.flex = '1 1 100%'
      style.minWidth = 200
      style.maxWidth = '100%'
      return style
    }
    if (node.type === 'button') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
      return style
    }
  }

  if (isActionRow(siblings)) {
    if (node.type === 'text') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
      return style
    }
    if (node.type === 'button') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
      return style
    }
  }

  if (isRecordRow(siblings)) {
    if (node.type === 'column') {
      style.flex = '2 1 160px'
      style.minWidth = 140
      return style
    }
    if (node.type === 'text') {
      const texts = siblings.filter((s) => s.type === 'text')
      const idx = texts.findIndex((s) => s.id === node.id)
      style.flex = '0 0 auto'
      style.flexShrink = 0
      if (idx === 0) {
        style.marginLeft = 'auto'
        style.minWidth = 72
      }
      if (idx === 1) style.minWidth = 52
      return style
    }
    if (node.type === 'row') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
      return style
    }
  }

  if (isSplitRow(siblings)) {
    if (node.type === 'column') {
      style.flex = '1 1 0'
      style.minWidth = 0
      return style
    }
    if (node.type === 'row') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
      style.width = 'auto'
      style.marginLeft = 'auto'
      return style
    }
  }

  if (isVersionListRow(siblings)) {
    if (node.type === 'column') {
      style.flex = '1 1 0'
      style.minWidth = 0
      return style
    }
    const trailingIdx = firstTrailingIndex(siblings)
    const nodeIdx = siblings.findIndex((s) => s.id === node.id)
    if (nodeIdx === trailingIdx) {
      style.marginLeft = 'auto'
    }
    if (node.type === 'button' || node.type === 'text' || node.type === 'row') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
      return style
    }
  }

  if (isHeaderRow(siblings)) {
    if (node.type === 'text') {
      style.flex = '0 1 auto'
      style.flexShrink = 0
      style.minWidth = 'min-content'
      return style
    }
    if (node.type === 'button') {
      style.flex = '0 0 auto'
      style.flexShrink = 0
      return style
    }
  }

  if (isKvRow(parent, siblings)) {
    style.flex = '0 0 auto'
    style.flexShrink = 0
    const texts = siblings.filter((s) => s.type === 'text')
    if (node.id === texts[1]?.id) {
      style.marginLeft = 'auto'
      style.textAlign = 'right'
    }
    return style
  }

  if (node.type === 'input') {
    if (node.inputType === 'search') {
      style.flex = '2 1 220px'
    } else {
      style.flex = '1 1 140px'
    }
    style.minWidth = 0
    return style
  }

  if (node.type === 'image' && node.imageRound) {
    style.flexShrink = 0
  }

  return style
}

export function isCenteredAuthPage(pageId: string) {
  return pageId === 'n2'
}
