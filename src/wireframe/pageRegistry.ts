import type { WireframePage } from './types'
import summary from '../data/summary.json'

const pageModules = import.meta.glob('../data/pages/*.json', {
  eager: true,
}) as Record<string, { default: WireframePage }>

const pages = new Map<string, WireframePage>()

for (const [path, mod] of Object.entries(pageModules)) {
  const page = mod.default
  pages.set(page.pageNodeId, page)
  const match = path.match(/\/(n\d+)\.json$/)
  if (match) {
    pages.set(match[1], page)
  }
}

export function getPage(pageId: string): WireframePage | undefined {
  return pages.get(pageId)
}

export function listPages() {
  return summary.pages.map((entry) => ({
    id: entry.pageNodeId,
    name: entry.pageName,
    totalNodes: entry.totalNodes,
  }))
}
