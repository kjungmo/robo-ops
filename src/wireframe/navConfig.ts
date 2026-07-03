import summary from '../data/summary.json'

export type NavSection = {
  title: string
  pageIds: string[]
}

const SECTIONS: NavSection[] = [
  { title: '인증', pageIds: ['n2', 'n3'] },
  { title: '관제', pageIds: ['n6', 'n7', 'n8', 'n9'] },
  { title: '알람·장애', pageIds: ['n13', 'n14', 'n15', 'n16', 'n17'] },
  { title: '원격 제어', pageIds: ['n23', 'n24', 'n25', 'n26', 'n27'] },
  { title: '맵 관리', pageIds: ['n33', 'n34', 'n35', 'n36', 'n37', 'n38'] },
  { title: '시스템', pageIds: ['n43', 'n44', 'n45', 'n46', 'n47', 'n48', 'n49', 'n50'] },
]

const pageNames = new Map(summary.pages.map((page) => [page.pageNodeId, page.pageName]))

export function getNavSections() {
  return SECTIONS.map((section) => ({
    title: section.title,
    items: section.pageIds.map((id) => ({
      id,
      name: pageNames.get(id) ?? id,
    })),
  }))
}
