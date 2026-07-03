import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getNavSections } from './navConfig'

type AppShellProps = {
  pageName: string
  children: ReactNode
}

export function AppShell({ pageName, children }: AppShellProps) {
  const location = useLocation()
  const sections = getNavSections()

  return (
    <div className="mf-app">
      <header className="mf-topbar">
        <div className="mf-topbar__brand">
          <span className="mf-topbar__logo">AMR/AGV</span>
          <span className="mf-topbar__title">통합 원격 관제 플랫폼</span>
        </div>
        <div className="mf-topbar__screen">{pageName}</div>
        <div className="mf-topbar__actions">
          <Link to="/pages" className="mf-topbar__link">
            화면 목록
          </Link>
          <span className="mf-topbar__user">운영자</span>
        </div>
      </header>

      <div className="mf-workspace">
        <aside className="mf-sidebar">
          {sections.map((section) => (
            <div key={section.title} className="mf-sidebar__section">
              <div className="mf-sidebar__heading">{section.title}</div>
              <ul className="mf-sidebar__list">
                {section.items.map((item) => {
                  const href = `/page/${item.id}`
                  const active = location.pathname === href
                  return (
                    <li key={item.id}>
                      <Link
                        to={href}
                        className={active ? 'mf-sidebar__link is-active' : 'mf-sidebar__link'}
                      >
                        {item.name}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </aside>

        <div className="mf-canvas-wrap">
          <div className="mf-canvas">{children}</div>
        </div>
      </div>
    </div>
  )
}
