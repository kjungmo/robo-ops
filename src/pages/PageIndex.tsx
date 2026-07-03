import { Link } from 'react-router-dom'
import { listPages } from '../wireframe/pageRegistry'
import '../wireframe/wireframe.css'

export function PageIndex() {
  const pages = listPages()

  return (
    <div className="wf-page-index">
      <h1>AMR/AGV 통합 원격 관제 플랫폼</h1>
      <p>{pages.length} wireframe screens exported from Manyfast.</p>
      <ul className="wf-page-list">
        {pages.map((page) => (
          <li key={page.id}>
            <Link to={`/page/${page.id}`}>
              <span>
                <strong>{page.id}</strong> — {page.name}
              </span>
              <span>{page.totalNodes} nodes</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
