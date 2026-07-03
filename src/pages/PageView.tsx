import { Link, useParams } from 'react-router-dom'
import { getPage } from '../wireframe/pageRegistry'
import { WireframeRenderer } from '../wireframe/WireframeRenderer'
import '../wireframe/wireframe.css'

export function PageView() {
  const { pageId } = useParams()
  const page = pageId ? getPage(pageId) : undefined

  if (!pageId || !page) {
    return (
      <div className="wf-missing">
        <h1>Screen not found</h1>
        <p>
          No wireframe for <code>{pageId ?? '(missing id)'}</code>.
        </p>
        <p>
          <Link to="/pages">Browse all 30 screens</Link> or try{' '}
          <Link to="/page/n2">/page/n2</Link> (login).
        </p>
      </div>
    )
  }

  return <WireframeRenderer page={page} />
}
