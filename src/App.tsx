import { Navigate, Route, Routes } from 'react-router-dom'
import { PageIndex } from './pages/PageIndex'
import { PageView } from './pages/PageView'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/page/n2" replace />} />
      <Route path="/pages" element={<PageIndex />} />
      <Route path="/page/:pageId" element={<PageView />} />
      <Route path="*" element={<Navigate to="/page/n2" replace />} />
    </Routes>
  )
}

export default App
