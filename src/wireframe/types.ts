export type WireframeAction =
  | { type: 'navigate'; targetPageNodeId: string }
  | { type: 'open-modal'; targetOverlayId: string }
  | { type: 'close' }

export type WireframeLayout = {
  gap?: number
  align?: 'start' | 'center' | 'end' | 'stretch'
  justify?: 'start' | 'center' | 'end' | 'between'
  width?: number
  height?: number
}

export type WireframeNode = {
  id: string
  type: string
  parentId: string | null
  childrenIds: string[]
  label?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'primary' | 'secondary' | 'danger' | 'chip'
  layout?: WireframeLayout
  attributes?: Record<string, string>
  action?: WireframeAction
  overlayId?: string
  listRows?: number
  inputType?: 'search' | 'select' | 'area' | 'check' | 'toggle' | 'text'
  imageRound?: boolean
  imageSize?: number
  spacerSize?: string
  activeIndex?: number
}

export type WireframePage = {
  pageNodeId: string
  pageName: string
  rootId: string
  nodes: Record<string, WireframeNode>
}
